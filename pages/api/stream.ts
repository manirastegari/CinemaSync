import type { NextApiRequest, NextApiResponse } from 'next';
import { getTokenFromRequest } from '@/lib/auth';
import { spawn, execSync } from 'child_process';

export const config = { api: { responseLimit: false } };

let ffmpegOk = false;
try { execSync('ffmpeg -version', { stdio: 'ignore' }); ffmpegOk = true; } catch {}

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!getTokenFromRequest(req)) return res.status(401).json({ error: 'Unauthorized' });
  if (!ffmpegOk) return res.status(503).json({ error: 'FFmpeg not installed' });

  const { url, start } = req.query;
  if (!url || typeof url !== 'string') return res.status(400).json({ error: 'url required' });

  const videoUrl = decodeURIComponent(url);
  const seekSec = Math.max(0, parseFloat(String(start || '0')) || 0);

  const args: string[] = [
    '-hide_banner', '-loglevel', 'warning',
    '-user_agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    '-headers', 'Accept: */*\r\nReferer: https://www.google.com/\r\n',
    '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5',
  ];

  // Fast seek: -ss before -i skips at the demuxer level (near-instant)
  if (seekSec > 0) args.push('-ss', String(seekSec));

  args.push(
    '-analyzeduration', '10000000', '-probesize', '10000000',
    '-i', videoUrl,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '26', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-ac', '2', '-b:a', '128k',
    '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
    '-f', 'mp4', 'pipe:1',
  );

  // Send headers immediately so browser keeps connection open during FFmpeg startup
  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Transfer-Encoding', 'chunked');
  res.flushHeaders();

  const ffmpeg = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let gotData = false;

  ffmpeg.stdout.on('data', (chunk: Buffer) => { gotData = true; res.write(chunk); });

  ffmpeg.stderr.on('data', (d: Buffer) => {
    const l = d.toString();
    if (/error|denied|forbidden|404|refused/i.test(l)) console.error('[ffmpeg]', l.trim());
  });

  ffmpeg.on('error', (err) => {
    console.error('[ffmpeg] spawn error:', err.message);
    res.end();
  });

  ffmpeg.on('close', (code) => {
    if (code !== 0 && !gotData) console.error('[ffmpeg] exit', code, '— no data produced');
    res.end();
  });

  req.on('close', () => { ffmpeg.kill('SIGKILL'); });
}
