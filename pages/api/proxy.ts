import type { NextApiRequest, NextApiResponse } from 'next';
import { getTokenFromRequest } from '@/lib/auth';
import https from 'https';
import http from 'http';

export const config = { api: { responseLimit: false, bodyParser: false } };

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Recursively follow redirects (up to maxRedirects)
function fetchWithRedirects(
  targetUrl: string,
  range: string | undefined,
  res: NextApiResponse,
  abortSignal: { aborted: boolean },
  redirectsLeft = 10,
): http.ClientRequest | undefined {
  if (redirectsLeft <= 0) {
    if (!res.headersSent) res.status(502).json({ error: 'Too many redirects' });
    return undefined;
  }

  let referer = 'https://www.google.com/';
  try { referer = new URL(targetUrl).origin + '/'; } catch {}

  const headers: Record<string, string> = {
    'User-Agent': UA,
    Accept: '*/*',
    Referer: referer,
    'Accept-Language': 'en-US,en;q=0.9',
  };
  if (range) headers['Range'] = range;

  const get = targetUrl.startsWith('https') ? https.get : http.get;

  const upstream = get(targetUrl, { headers, timeout: 20000 }, (remote) => {
    if (abortSignal.aborted) { remote.destroy(); return; }

    const status = remote.statusCode ?? 500;

    // Follow redirects
    if ([301, 302, 303, 307, 308].includes(status) && remote.headers.location) {
      const next = new URL(remote.headers.location, targetUrl).href;
      console.log('[proxy] redirect', status, '→', next.substring(0, 80));
      remote.resume(); // drain response
      fetchWithRedirects(next, range, res, abortSignal, redirectsLeft - 1);
      return;
    }

    // Determine MIME type — always a playable video type so browser streams instead of downloading.
    // MKV → video/mp4: Chrome ignores the declared type and probes the codec; H.264 MKV plays fine.
    // video/x-matroska is NOT in Chrome's recognised-types list and triggers a download.
    const ct = (remote.headers['content-type'] || '').toLowerCase();
    let mime = 'video/mp4';
    if (ct.startsWith('video/') && !ct.includes('matroska') && !ct.includes('x-msvideo')) mime = ct;
    else if (ct.startsWith('audio/')) mime = ct;
    // else: fall back to video/mp4 (covers octet-stream, matroska, avi, unknown, etc.)

    const outHeaders: Record<string, string> = {
      'Content-Type': mime,
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': '*',
      'Accept-Ranges': 'bytes',
      // Never forward Content-Disposition — it would force a file download in the browser
    };

    if (remote.headers['content-length']) outHeaders['Content-Length'] = remote.headers['content-length'];
    if (remote.headers['content-range']) outHeaders['Content-Range'] = remote.headers['content-range'];

    res.writeHead(status, outHeaders);
    remote.pipe(res);
  });

  upstream.on('error', (err) => {
    console.error('[proxy] error:', err.message);
    if (!res.headersSent) res.status(502).json({ error: 'Failed to fetch video: ' + err.message });
    else if (!res.writableEnded) res.end();
  });

  upstream.on('timeout', () => {
    console.error('[proxy] connection timeout');
    upstream.destroy();
    if (!res.headersSent) res.status(504).json({ error: 'Connection to video server timed out' });
  });

  return upstream;
}

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const payload = getTokenFromRequest(req);
  if (!payload) return res.status(401).json({ error: 'Unauthorized' });

  const { url } = req.query;
  if (!url || typeof url !== 'string') return res.status(400).json({ error: 'url required' });

  const videoUrl = decodeURIComponent(url);
  const abortSignal = { aborted: false };

  const upstream = fetchWithRedirects(videoUrl, req.headers.range, res, abortSignal);

  req.on('close', () => {
    abortSignal.aborted = true;
    upstream?.destroy();
  });
}
