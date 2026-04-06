import type { NextApiRequest, NextApiResponse } from 'next';
import { getTokenFromRequest } from '@/lib/auth';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

export const config = { api: { responseLimit: false } };

function getFfmpegPath(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const staticPath = require('ffmpeg-static') as string;
    if (staticPath && fs.existsSync(staticPath)) return staticPath;
  } catch { /* fallthrough */ }
  // fallback: system ffmpeg
  return 'ffmpeg';
}

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const payload = getTokenFromRequest(req);
  if (!payload) return res.status(401).json({ error: 'Unauthorized' });

  const { url } = req.query;
  if (!url || typeof url !== 'string') return res.status(400).json({ error: 'url required' });

  const videoUrl = decodeURIComponent(url);

  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Access-Control-Allow-Origin', '*');

  const ffmpegBin = getFfmpegPath();

  const args = [
    '-i', videoUrl,
    '-c:v', 'copy',       // copy video stream as-is (no re-encode = fast + low CPU)
    '-c:a', 'aac',        // convert audio to AAC (browser-safe)
    '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
    '-f', 'mp4',
    'pipe:1',             // output to stdout
  ];

  const ffmpeg = spawn(ffmpegBin, args, { stdio: ['ignore', 'pipe', 'pipe'] });

  ffmpeg.stdout.pipe(res);

  ffmpeg.stderr.on('data', (d: Buffer) => {
    const line = d.toString();
    if (line.includes('Error') || line.includes('error')) console.error('[ffmpeg]', line.trim());
  });

  ffmpeg.on('error', (err) => {
    console.error('[ffmpeg] spawn error:', err.message);
    if (!res.headersSent) res.status(500).json({ error: 'FFmpeg not available' });
    else res.end();
  });

  ffmpeg.on('close', (code) => {
    if (code !== 0) console.error('[ffmpeg] exited with code', code);
    res.end();
  });

  req.on('close', () => {
    ffmpeg.kill('SIGKILL');
  });
}
