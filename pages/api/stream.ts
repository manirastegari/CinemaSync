import type { NextApiRequest, NextApiResponse } from 'next';
import { getTokenFromRequest } from '@/lib/auth';
import { spawn, execSync, ChildProcess } from 'child_process';
import type { ServerResponse } from 'http';

export const config = { api: { responseLimit: false } };

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

let ffmpegOk = false;
try { execSync('ffmpeg -version', { stdio: 'ignore' }); ffmpegOk = true; } catch {}

/* ── Shared FFmpeg session ─────────────────────────────────────────────────
 * ONE FFmpeg process per video URL.  All viewers share the same output.
 * New joiners receive the init segment (ftyp + moov) then live chunks.
 * When all clients disconnect, FFmpeg is killed after a grace period.
 * ─────────────────────────────────────────────────────────────────────── */

interface Session {
  url: string;
  seek: number;
  ffmpeg: ChildProcess;
  initData: Buffer[];        // first ~64 KB (ftyp + moov atoms)
  initSize: number;
  clients: Set<ServerResponse>;
  gotData: boolean;
  dead: boolean;
  killTimer: ReturnType<typeof setTimeout> | null;
  dataTimeout: ReturnType<typeof setTimeout> | null;
  stderrBuf: string;
  // The first client that created this session (needs special error handling)
  creator: ServerResponse | null;
  creatorHeadersSent: boolean;
}

let session: Session | null = null;

function killSession() {
  if (!session) return;
  const s = session;
  s.dead = true;
  if (s.killTimer) clearTimeout(s.killTimer);
  if (s.dataTimeout) clearTimeout(s.dataTimeout);
  try { s.ffmpeg.kill('SIGKILL'); } catch {}
  s.clients.forEach((c) => { try { if (!c.writableEnded) c.end(); } catch {} });
  session = null;
  console.log('[stream] session killed');
}

function sendHeaders(res: ServerResponse) {
  if (!res.headersSent) {
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Transfer-Encoding', 'chunked');
  }
}

function startSession(videoUrl: string, seekSec: number, creatorRes: ServerResponse): Session {
  let referer = 'https://www.google.com/';
  try { referer = new URL(videoUrl).origin + '/'; } catch {}

  const args: string[] = [
    '-hide_banner', '-loglevel', 'warning',
    '-user_agent', UA,
    '-headers', `Accept: */*\r\nReferer: ${referer}\r\nAccept-Language: en-US,en;q=0.9\r\n`,
    '-reconnect', '1', '-reconnect_streamed', '1',
    '-reconnect_on_network_error', '1', '-reconnect_delay_max', '10',
    '-rw_timeout', '15000000',
  ];
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

  console.log('[stream] NEW session', videoUrl.substring(0, 60), 'seek=', seekSec);
  const ffmpeg = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });

  const s: Session = {
    url: videoUrl, seek: seekSec, ffmpeg,
    initData: [], initSize: 0,
    clients: new Set([creatorRes]),
    gotData: false, dead: false,
    killTimer: null, dataTimeout: null,
    stderrBuf: '',
    creator: creatorRes, creatorHeadersSent: false,
  };

  // Timeout: 25 s for first data
  s.dataTimeout = setTimeout(() => {
    if (!s.gotData && !s.dead) {
      console.error('[stream] timeout — no data in 25s. stderr:', s.stderrBuf.slice(-500));
      // Send error to creator if headers not yet sent
      if (s.creator && !s.creator.headersSent) {
        (s.creator as unknown as NextApiResponse).status(502).json({
          error: 'Transcoding timed out — video URL may be inaccessible.',
        });
        s.creator = null;
      }
      killSession();
    }
  }, 25000);

  // ── FFmpeg stdout: broadcast to all clients ──
  ffmpeg.stdout!.on('data', (chunk: Buffer) => {
    if (s.dead) return;

    if (!s.gotData) {
      // First data: send headers to creator
      s.gotData = true;
      if (s.dataTimeout) { clearTimeout(s.dataTimeout); s.dataTimeout = null; }
      if (s.creator && !s.creator.headersSent) {
        sendHeaders(s.creator);
        s.creatorHeadersSent = true;
      }
      console.log('[stream] first chunk — broadcasting to', s.clients.size, 'client(s)');
    }

    // Cache init segment (first ~64 KB — contains ftyp + moov atoms)
    if (s.initSize < 65536) {
      s.initData.push(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength));
      s.initSize += chunk.length;
    }

    // Broadcast to all connected clients
    s.clients.forEach((c) => {
      try { if (!c.writableEnded) c.write(chunk); } catch {}
    });
  });

  ffmpeg.stderr!.on('data', (d: Buffer) => {
    const line = d.toString();
    s.stderrBuf += line;
    if (s.stderrBuf.length > 4096) s.stderrBuf = s.stderrBuf.slice(-4096);
    if (/error|denied|forbidden|404|refused|timeout/i.test(line)) {
      console.error('[ffmpeg]', line.trim());
    }
  });

  ffmpeg.on('error', (err) => {
    console.error('[ffmpeg] spawn error:', err.message);
    if (s.creator && !s.creator.headersSent) {
      (s.creator as unknown as NextApiResponse).status(500).json({
        error: 'FFmpeg failed to start: ' + err.message,
      });
    }
    killSession();
  });

  ffmpeg.on('close', (code) => {
    if (s.dead) return;
    if (code !== 0 && !s.gotData) {
      console.error('[ffmpeg] exit', code, '— no data. stderr:', s.stderrBuf.slice(-400));
      if (s.creator && !s.creator.headersSent) {
        (s.creator as unknown as NextApiResponse).status(502).json({
          error: 'Transcoding failed (exit ' + code + '). URL may be blocked or unsupported.',
        });
      }
    }
    // End all client responses
    s.clients.forEach((c) => { try { if (!c.writableEnded) c.end(); } catch {} });
    if (session === s) session = null;
  });

  return s;
}

function scheduleKill() {
  if (!session || session.clients.size > 0) return;
  session.killTimer = setTimeout(() => {
    if (session && session.clients.size === 0) {
      console.log('[stream] no clients — killing FFmpeg');
      killSession();
    }
  }, 15000); // 15 s grace period
}

/* ── HTTP handler ─────────────────────────────────────────────────────── */

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!getTokenFromRequest(req)) return res.status(401).json({ error: 'Unauthorized' });
  if (!ffmpegOk) return res.status(503).json({ error: 'FFmpeg not installed on server' });

  const { url, start } = req.query;
  if (!url || typeof url !== 'string') return res.status(400).json({ error: 'url required' });

  const videoUrl = decodeURIComponent(url);
  const seekSec = Math.max(0, parseFloat(String(start || '0')) || 0);
  const raw = res as unknown as ServerResponse;

  // ── JOIN existing session if same URL + close seek ──
  if (session && !session.dead && session.url === videoUrl && Math.abs(session.seek - seekSec) < 3) {
    console.log('[stream] client JOINING existing session (now', session.clients.size + 1, 'clients)');
    if (session.killTimer) { clearTimeout(session.killTimer); session.killTimer = null; }

    // Send headers + cached init data so browser can start playing immediately
    sendHeaders(raw);
    session.initData.forEach((chunk) => { try { raw.write(chunk); } catch {} });

    // Join live broadcast
    session.clients.add(raw);

    req.on('close', () => {
      session?.clients.delete(raw);
      scheduleKill();
    });
    return;
  }

  // ── NEW session (different URL or seek) ──
  killSession();
  session = startSession(videoUrl, seekSec, raw);

  req.on('close', () => {
    if (!session) return;
    session.clients.delete(raw);
    if (session.creator === raw) session.creator = null;
    scheduleKill();
  });
}
