import type { NextApiRequest, NextApiResponse } from 'next';
import { getTokenFromRequest } from '@/lib/auth';
import https from 'https';
import http from 'http';

export const config = { api: { responseLimit: false, bodyParser: false } };

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const payload = getTokenFromRequest(req);
  if (!payload) return res.status(401).json({ error: 'Unauthorized' });

  const { url } = req.query;
  if (!url || typeof url !== 'string') return res.status(400).json({ error: 'url required' });

  const videoUrl = decodeURIComponent(url);

  // Build outgoing headers — forward Range for seeking
  const headers: Record<string, string> = {
    'User-Agent': BROWSER_UA,
    Accept: '*/*',
    Referer: 'https://www.google.com/',
  };
  if (req.headers.range) {
    headers['Range'] = req.headers.range;
  }

  const get = videoUrl.startsWith('https') ? https.get : http.get;

  const upstream = get(videoUrl, { headers }, (remote) => {
    const status = remote.statusCode ?? 500;

    // Map content-type: force video MIME (download servers send application/octet-stream)
    const ct = remote.headers['content-type'] || '';
    let mime = 'video/mp4';
    if (ct.includes('matroska') || videoUrl.toLowerCase().includes('.mkv')) mime = 'video/x-matroska';
    else if (ct.includes('video/')) mime = ct;

    const outHeaders: Record<string, string> = {
      'Content-Type': mime,
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': '*',
      'Accept-Ranges': 'bytes',
    };

    // Forward range-related headers
    if (remote.headers['content-length']) outHeaders['Content-Length'] = remote.headers['content-length'];
    if (remote.headers['content-range']) outHeaders['Content-Range'] = remote.headers['content-range'];

    res.writeHead(status === 301 || status === 302 ? 200 : status, outHeaders);
    remote.pipe(res);
  });

  upstream.on('error', (err) => {
    console.error('[proxy] upstream error:', err.message);
    if (!res.headersSent) res.status(502).json({ error: 'Failed to fetch video: ' + err.message });
    else res.end();
  });

  req.on('close', () => {
    upstream.destroy();
  });
}
