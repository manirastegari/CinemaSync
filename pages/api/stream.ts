import type { NextApiRequest, NextApiResponse } from 'next';
import { getTokenFromRequest } from '@/lib/auth';
import { spawn, execSync } from 'child_process';

export const config = { api: { responseLimit: false } };

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

let ffmpegOk = false;
try { execSync('ffmpeg -version', { stdio: 'ignore' }); ffmpegOk = true; } catch {}

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!getTokenFromRequest(req)) return res.status(401).json({ error: 'Unauthorized' });
  if (!ffmpegOk) return res.status(503).json({ error: 'FFmpeg not installed on server' });

  const { url, start } = req.query;
  if (!url || typeof url !== 'string') return res.status(400).json({ error: 'url required' });

  const videoUrl = decodeURIComponent(url);
  const seekSec = Math.max(0, parseFloat(String(start || '0')) || 0);

  // Dynamic Referer matching source domain (many CDNs check this)
  let referer = 'https://www.google.com/';
  try { referer = new URL(videoUrl).origin + '/'; } catch {}

  const args: string[] = [
    '-hide_banner', '-loglevel', 'info',
    '-user_agent', UA,
    '-headers', `Accept: */*\r\nReferer: ${referer}\r\nAccept-Language: en-US,en;q=0.9\r\n`,
    '-reconnect', '1',
    '-reconnect_streamed', '1',
    '-reconnect_on_network_error', '1',
    '-reconnect_delay_max', '10',
    '-rw_timeout', '15000000',
  ];

  // Fast seek: -ss before -i skips at the demuxer level (near-instant)
  if (seekSec > 0) args.push('-ss', String(seekSec));

  args.push(
    '-analyzeduration', '20000000', '-probesize', '20000000',
    '-fflags', '+genpts+discardcorrupt',
    '-i', videoUrl,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency',
    '-crf', '28', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-ac', '2', '-b:a', '128k',
    '-max_muxing_queue_size', '2048',
    '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
    '-f', 'mp4', 'pipe:1',
  );

  console.log('[stream] start', videoUrl.substring(0, 80), 'seek=', seekSec);

  const ffmpeg = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let gotData = false;
  let stderrBuf = '';

  // Timeout: if no data produced within 25s, return error
  const dataTimeout = setTimeout(() => {
    if (!gotData) {
      console.error('[stream] timeout — no data in 25s. stderr:', stderrBuf.slice(-500));
      ffmpeg.kill('SIGKILL');
      if (!res.headersSent) {
        res.status(502).json({ error: 'Transcoding timed out — the video URL may be inaccessible from the server.' });
      } else {
        res.end();
      }
    }
  }, 25000);

  ffmpeg.stdout.on('data', (chunk: Buffer) => {
    if (!gotData) {
      // First chunk: NOW send headers (we know FFmpeg is producing data)
      gotData = true;
      clearTimeout(dataTimeout);
      res.setHeader('Content-Type', 'video/mp4');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Transfer-Encoding', 'chunked');
      console.log('[stream] first data chunk — streaming');
    }
    if (!res.writableEnded) res.write(chunk);
  });

  ffmpeg.stderr.on('data', (d: Buffer) => {
    const line = d.toString();
    stderrBuf += line;
    if (stderrBuf.length > 4096) stderrBuf = stderrBuf.slice(-4096);
    if (/error|denied|forbidden|404|refused|timeout|timed out/i.test(line)) {
      console.error('[ffmpeg]', line.trim());
    }
  });

  ffmpeg.on('error', (err) => {
    clearTimeout(dataTimeout);
    console.error('[ffmpeg] spawn error:', err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: 'FFmpeg failed to start: ' + err.message });
    } else if (!res.writableEnded) {
      res.end();
    }
  });

  ffmpeg.on('close', (code) => {
    clearTimeout(dataTimeout);
    if (code !== 0 && !gotData) {
      console.error('[ffmpeg] exit', code, '— no data. stderr:', stderrBuf.slice(-500));
      if (!res.headersSent) {
        res.status(502).json({ error: 'Transcoding failed (FFmpeg exit ' + code + '). URL may be blocked or format unsupported.' });
      }
    }
    if (!res.writableEnded) res.end();
  });

  req.on('close', () => {
    clearTimeout(dataTimeout);
    ffmpeg.kill('SIGKILL');
  });
}
