import type { NextApiRequest, NextApiResponse } from 'next';
import { getTokenFromRequest } from '@/lib/auth';
import { spawn, execSync } from 'child_process';

export const config = { api: { responseLimit: false } };

// Check once at startup whether ffmpeg is available
let ffmpegAvailable = false;
try {
  execSync('ffmpeg -version', { stdio: 'ignore' });
  ffmpegAvailable = true;
  console.log('  ✦ FFmpeg found');
} catch {
  console.warn('  ✖ FFmpeg NOT found — /api/stream will not work');
}

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const payload = getTokenFromRequest(req);
  if (!payload) return res.status(401).json({ error: 'Unauthorized' });

  if (!ffmpegAvailable) {
    return res.status(503).json({ error: 'FFmpeg is not installed on this server.' });
  }

  const { url } = req.query;
  if (!url || typeof url !== 'string') return res.status(400).json({ error: 'url required' });

  const videoUrl = decodeURIComponent(url);

  const args = [
    '-hide_banner', '-loglevel', 'warning',
    // Spoof browser so download servers accept the request
    '-user_agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    '-headers', 'Accept: */*\r\nReferer: https://www.google.com/\r\n',
    // Allow time for slow servers to respond
    '-analyzeduration', '10000000',
    '-probesize', '10000000',
    '-i', videoUrl,
    // Transcode video to H.264 (the only universally supported codec)
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '26',
    '-pix_fmt', 'yuv420p',
    // Convert any audio (AC3/DTS/5.1) to stereo AAC
    '-c:a', 'aac', '-ac', '2', '-b:a', '128k',
    // Fragmented MP4 for streaming (no seek-back needed)
    '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
    '-f', 'mp4',
    'pipe:1',
  ];

  let headersSent = false;
  let gotData = false;

  const ffmpeg = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });

  ffmpeg.stdout.on('data', (chunk: Buffer) => {
    if (!headersSent) {
      res.setHeader('Content-Type', 'video/mp4');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Transfer-Encoding', 'chunked');
      headersSent = true;
    }
    gotData = true;
    res.write(chunk);
  });

  const stderrChunks: string[] = [];
  ffmpeg.stderr.on('data', (d: Buffer) => {
    const line = d.toString();
    stderrChunks.push(line);
    // Log real errors (not progress)
    if (/error|invalid|denied|forbidden|404|refused/i.test(line)) {
      console.error('[ffmpeg]', line.trim());
    }
  });

  ffmpeg.on('error', (err) => {
    console.error('[ffmpeg] spawn error:', err.message);
    if (!headersSent) {
      res.status(500).json({ error: 'FFmpeg failed to start: ' + err.message });
    } else {
      res.end();
    }
  });

  ffmpeg.on('close', (code) => {
    if (code !== 0 && !gotData) {
      console.error('[ffmpeg] failed (exit ' + code + '):', stderrChunks.join('').slice(-500));
      if (!headersSent) {
        res.status(502).json({
          error: 'FFmpeg could not process this video. It may be a network issue or unsupported codec.',
          details: stderrChunks.join('').slice(-300),
        });
      }
    }
    res.end();
  });

  req.on('close', () => {
    ffmpeg.kill('SIGKILL');
  });
}
