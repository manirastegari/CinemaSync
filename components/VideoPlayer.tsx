import React, {
  useRef,
  useState,
  useEffect,
  useCallback,
  forwardRef,
  useImperativeHandle,
} from 'react';
import type Hls from 'hls.js';

export interface VideoPlayerHandle {
  getCurrentTime: () => number;
  seek: (time: number) => void;
  play: () => void;
  pause: () => void;
  setVolume: (v: number) => void;
}

interface Props {
  src: string;
  isAdmin: boolean;
  onPlay?: (t: number) => void;
  onPause?: (t: number) => void;
  onSeek?: (t: number) => void;
  onTimeUpdate?: (t: number) => void;
  connectedUsers?: { username: string; role: string }[];
  voiceActive?: boolean;
  isMuted?: boolean;
  onToggleMic?: () => void;
}

function formatTime(s: number): string {
  if (!s || isNaN(s)) return '0:00';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

function getVideoFormat(url: string): 'hls' | 'proxy' | 'native' {
  if (!url) return 'native';
  const u = url.toLowerCase().split('?')[0];
  if (u.endsWith('.m3u8')) return 'hls';
  if (u.endsWith('.mkv') || u.endsWith('.avi') || u.endsWith('.flv') || u.endsWith('.mov')) return 'proxy';
  return 'native';
}

function proxyUrl(src: string): string {
  return `/api/stream?url=${encodeURIComponent(src)}`;
}

const VideoPlayer = forwardRef<VideoPlayerHandle, Props>(function VideoPlayer(
  { src, isAdmin, onPlay, onPause, onSeek, onTimeUpdate, connectedUsers = [], voiceActive, isMuted, onToggleMic },
  ref
) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const progressRef = useRef<HTMLInputElement>(null);
  const controlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hlsRef = useRef<Hls | null>(null);

  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [buffered, setBuffered] = useState(0);
  const [buffering, setBuffering] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [videoError, setVideoError] = useState('');
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [newUrl, setNewUrl] = useState('');

  useImperativeHandle(ref, () => ({
    getCurrentTime: () => videoRef.current?.currentTime ?? 0,
    seek: (time: number) => {
      if (videoRef.current) videoRef.current.currentTime = time;
    },
    play: () => {
      const v = videoRef.current;
      if (!v) return;
      v.play().catch(() => {
        v.muted = true;
        setMuted(true);
        v.play().catch(console.error);
      });
    },
    pause: () => { videoRef.current?.pause(); },
    setVolume: (v: number) => {
      if (videoRef.current) {
        videoRef.current.volume = Math.max(0, Math.min(1, v));
        setVolume(Math.max(0, Math.min(1, v)));
      }
    },
  }));

  const resetControlsTimer = useCallback(() => {
    setShowControls(true);
    if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    controlsTimerRef.current = setTimeout(() => {
      if (playing) setShowControls(false);
    }, 3000);
  }, [playing]);

  // ── HLS / format handling ────────────────────────────────────────────────
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !src) return;

    const fmt = getVideoFormat(src);

    if (fmt === 'hls') {
      import('hls.js').then(({ default: HlsLib }) => {
        if (!HlsLib.isSupported()) {
          // Safari supports HLS natively
          v.src = src;
          v.load();
          return;
        }
        if (hlsRef.current) hlsRef.current.destroy();
        const hls = new HlsLib({ enableWorker: true, xhrSetup: (xhr) => { xhr.withCredentials = false; } });
        hlsRef.current = hls;
        hls.loadSource(src);
        hls.attachMedia(v);
      });
      return () => { hlsRef.current?.destroy(); hlsRef.current = null; };
    }

    // proxy (mkv/avi/flv) or native — set src directly
    if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
    v.src = fmt === 'proxy' ? proxyUrl(src) : src;
    v.load();
  }, [src]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    const handlers: [string, EventListener][] = [
      ['timeupdate', () => {
        setCurrentTime(v.currentTime);
        onTimeUpdate?.(v.currentTime);
        if (v.buffered.length > 0) {
          setBuffered((v.buffered.end(v.buffered.length - 1) / v.duration) * 100);
        }
      }],
      ['loadedmetadata', () => setDuration(v.duration)],
      ['durationchange', () => setDuration(v.duration)],
      ['play', () => setPlaying(true)],
      ['pause', () => setPlaying(false)],
      ['waiting', () => setBuffering(true)],
      ['playing', () => setBuffering(false)],
      ['canplay', () => setBuffering(false)],
      ['error', () => {
        const code = v.error?.code;
        if (code === 4) {
          setVideoError('This video format is not supported by your browser. Try Chrome on macOS or Safari for H.265/MKV files.');
        } else {
          setVideoError(`Video failed to load (error ${code ?? 'unknown'}). Check the URL or network.`);
        }
      }],
      ['fullscreenchange', () => setIsFullscreen(!!document.fullscreenElement)],
    ];

    handlers.forEach(([event, fn]) => v.addEventListener(event, fn));
    return () => handlers.forEach(([event, fn]) => v.removeEventListener(event, fn));
  }, [onTimeUpdate]);

  useEffect(() => {
    setVideoError('');
    setCurrentTime(0);
    setDuration(0);
    setPlaying(false);
  }, [src]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      const v = videoRef.current;
      if (!v) return;

      switch (e.key) {
        case ' ':
        case 'k':
          e.preventDefault();
          if (isAdmin) { v.paused ? handlePlay() : handlePause(); }
          break;
        case 'ArrowRight':
          if (isAdmin) { e.preventDefault(); handleSkip(10); }
          break;
        case 'ArrowLeft':
          if (isAdmin) { e.preventDefault(); handleSkip(-10); }
          break;
        case 'ArrowUp':
          e.preventDefault();
          handleVolumeChange(Math.min(1, volume + 0.1));
          break;
        case 'ArrowDown':
          e.preventDefault();
          handleVolumeChange(Math.max(0, volume - 0.1));
          break;
        case 'f':
          e.preventDefault();
          handleFullscreen();
          break;
        case 'm':
          e.preventDefault();
          setMuted((m) => { if (v) v.muted = !m; return !m; });
          break;
      }
    };

    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isAdmin, volume]); // eslint-disable-line react-hooks/exhaustive-deps

  function handlePlay() {
    const v = videoRef.current;
    if (!v) return;
    v.play().catch(() => {
      // Mobile autoplay blocked — try muted as fallback
      v.muted = true;
      setMuted(true);
      v.play().catch(console.error);
    });
    onPlay?.(v.currentTime);
  }

  function handlePause() {
    videoRef.current?.pause();
    onPause?.(videoRef.current?.currentTime ?? 0);
  }

  function handleSeek(time: number) {
    if (videoRef.current) {
      videoRef.current.currentTime = time;
      onSeek?.(time);
    }
  }

  function handleSkip(delta: number) {
    const v = videoRef.current;
    if (!v) return;
    const next = Math.max(0, Math.min(v.duration || 0, v.currentTime + delta));
    v.currentTime = next;
    onSeek?.(next);
  }

  function handleVolumeChange(val: number) {
    const v = videoRef.current;
    if (!v) return;
    v.volume = val;
    setVolume(val);
    if (val > 0) { v.muted = false; setMuted(false); }
  }

  function handleFullscreen() {
    const el = containerRef.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      el.requestFullscreen().catch(console.error);
    } else {
      document.exitFullscreen().catch(console.error);
    }
  }

  function handleRotate() {
    setRotation((r) => (r + 90) % 360);
  }

  const progressPercent = duration ? (currentTime / duration) * 100 : 0;

  const speeds = [0.5, 0.75, 1, 1.25, 1.5, 2];

  return (
    <div
      ref={containerRef}
      className="relative w-full bg-black select-none overflow-hidden"
      style={{ aspectRatio: rotation % 180 === 0 ? '16/9' : '9/16' }}
      onMouseMove={resetControlsTimer}
      onTouchStart={resetControlsTimer}
      onClick={() => {
        resetControlsTimer();
        if (!showSpeedMenu) return;
        setShowSpeedMenu(false);
      }}
    >
      {/* Video element — src set by format-detection useEffect */}
      <video
        ref={videoRef}
        className="w-full h-full object-contain transition-transform duration-300"
        style={{ transform: `rotate(${rotation}deg)` }}
        playsInline
        preload="metadata"
        onDoubleClick={isAdmin ? (playing ? handlePause : handlePlay) : undefined}
      />

      {/* Buffering overlay */}
      {buffering && !videoError && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="buffering-spinner" />
        </div>
      )}

      {/* Error overlay */}
      {videoError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 text-center px-6">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="#6366f1" className="mb-4 opacity-70">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
          </svg>
          <p className="text-white text-sm mb-2 font-medium">Playback Error</p>
          <p className="text-surface-400 text-xs max-w-md">{videoError}</p>
        </div>
      )}

      {/* No source */}
      {!src && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black text-center px-6">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="#3f3f46" className="mb-4">
            <path d="M18 4l2 4h-3l-2-4h-2l2 4h-3l-2-4H8l2 4H7L5 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V4h-4z"/>
          </svg>
          <p className="text-surface-500 text-sm">No video loaded</p>
          {isAdmin && (
            <p className="text-surface-600 text-xs mt-1">Set a video URL in the Admin dashboard.</p>
          )}
        </div>
      )}

      {/* Top gradient + info bar */}
      <div
        className={`absolute top-0 left-0 right-0 player-gradient-top transition-opacity duration-300 ${showControls ? 'opacity-100' : 'opacity-0'}`}
        style={{ paddingTop: '2px', paddingBottom: '40px' }}
      >
        <div className="flex items-center justify-between px-4 pt-3">
          <div className="flex items-center gap-2">
            <span
              className={`text-xs font-semibold px-2.5 py-1 rounded-full text-white ${isAdmin ? 'badge-admin' : 'badge-user'}`}
            >
              {isAdmin ? '⚡ ADMIN' : '👁 VIEWER'}
            </span>
            {connectedUsers.length > 0 && (
              <div className="flex items-center gap-1.5 bg-black/40 rounded-full px-2.5 py-1">
                <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse-slow" />
                <span className="text-white text-xs">
                  {connectedUsers.length} online
                </span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            {/* Mic button */}
            <button
              onClick={onToggleMic}
              className={`relative flex items-center justify-center w-9 h-9 rounded-full transition-all ${
                voiceActive && !isMuted
                  ? 'bg-green-500 shadow-lg shadow-green-500/30'
                  : voiceActive && isMuted
                  ? 'bg-red-500 shadow-lg shadow-red-500/30'
                  : 'bg-white/10 hover:bg-white/20'
              }`}
              title={voiceActive ? (isMuted ? 'Unmute mic' : 'Mute mic') : 'Start voice chat'}
            >
              {voiceActive && !isMuted ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
                  <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1-9c0-.55.45-1 1-1s1 .45 1 1v6c0 .55-.45 1-1 1s-1-.45-1-1V5zm6 6c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
                </svg>
              ) : voiceActive && isMuted ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
                  <path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.34 3 3 3 .23 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z"/>
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="white" opacity="0.6">
                  <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1-9c0-.55.45-1 1-1s1 .45 1 1v6c0 .55-.45 1-1 1s-1-.45-1-1V5zm6 6c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
                </svg>
              )}
            </button>

            {/* Connected users avatars */}
            <div className="flex -space-x-1">
              {connectedUsers.slice(0, 4).map((u, i) => (
                <div
                  key={i}
                  className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold border-2 border-black"
                  style={{
                    background:
                      u.role === 'admin'
                        ? 'linear-gradient(135deg,#6366f1,#8b5cf6)'
                        : 'linear-gradient(135deg,#0ea5e9,#06b6d4)',
                  }}
                  title={u.username}
                >
                  {u.username.charAt(0).toUpperCase()}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Bottom controls */}
      <div
        className={`absolute bottom-0 left-0 right-0 player-gradient-bottom transition-opacity duration-300 ${showControls ? 'opacity-100' : 'opacity-0'}`}
        style={{ paddingTop: '60px' }}
      >
        {/* Progress bar */}
        <div className="px-4 mb-3">
          <div className="relative h-5 flex items-center group">
            {/* Buffered track */}
            <div
              className="absolute h-1 rounded-full bg-white/20 pointer-events-none"
              style={{ width: `${buffered}%` }}
            />
            {/* Played track */}
            <div
              className="absolute h-1 rounded-full bg-brand-500 pointer-events-none"
              style={{ width: `${progressPercent}%` }}
            />
            <input
              ref={progressRef}
              type="range"
              className="progress-bar w-full relative z-10"
              min={0}
              max={duration || 100}
              step={0.1}
              value={currentTime}
              disabled={!isAdmin}
              onChange={(e) => handleSeek(parseFloat(e.target.value))}
              style={{
                background: 'transparent',
                cursor: isAdmin ? 'pointer' : 'default',
              }}
            />
          </div>
        </div>

        {/* Controls row */}
        <div className="flex items-center px-4 pb-4 gap-2">
          {/* Skip back (admin only) */}
          {isAdmin && (
            <button
              onClick={() => handleSkip(-10)}
              className="text-white/80 hover:text-white transition-colors tooltip"
              data-tip="-10s"
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                <path d="M11 18V6l-8.5 6 8.5 6zm.5-6l8.5 6V6l-8.5 6z"/>
              </svg>
            </button>
          )}

          {/* Play/Pause (admin only) */}
          {isAdmin ? (
            <button
              onClick={playing ? handlePause : handlePlay}
              className="text-white hover:text-brand-400 transition-colors w-10 h-10 flex items-center justify-center"
            >
              {playing ? (
                <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
                </svg>
              ) : (
                <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M8 6.82v10.36c0 .79.87 1.27 1.54.84l8.14-5.18c.62-.39.62-1.29 0-1.69L9.54 5.98C8.87 5.55 8 6.03 8 6.82z"/>
                </svg>
              )}
            </button>
          ) : (
            <div className="w-10 h-10 flex items-center justify-center">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="rgba(255,255,255,0.3)">
                <path d="M8 6.82v10.36c0 .79.87 1.27 1.54.84l8.14-5.18c.62-.39.62-1.29 0-1.69L9.54 5.98C8.87 5.55 8 6.03 8 6.82z"/>
              </svg>
            </div>
          )}

          {/* Skip forward (admin only) */}
          {isAdmin && (
            <button
              onClick={() => handleSkip(10)}
              className="text-white/80 hover:text-white transition-colors tooltip"
              data-tip="+10s"
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                <path d="M4 18l8.5-6L4 6v12zm9-12v12l8.5-6L13 6z"/>
              </svg>
            </button>
          )}

          {/* Volume */}
          <button
            onClick={() => {
              const v = videoRef.current;
              if (!v) return;
              v.muted = !muted;
              setMuted(!muted);
            }}
            className="text-white/80 hover:text-white transition-colors ml-1"
          >
            {muted || volume === 0 ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/>
              </svg>
            ) : volume < 0.5 ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M18.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM5 9v6h4l5 5V4L9 9H5z"/>
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
              </svg>
            )}
          </button>

          <input
            type="range"
            className="volume-slider"
            min={0}
            max={1}
            step={0.01}
            value={muted ? 0 : volume}
            onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
          />

          {/* Time */}
          <span className="text-white/80 text-xs font-mono ml-1 flex-shrink-0">
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>

          <div className="flex-1" />

          {/* Speed (admin only) */}
          {isAdmin && (
            <div className="relative">
              <button
                onClick={() => setShowSpeedMenu((s) => !s)}
                className="text-white/70 hover:text-white text-xs font-medium px-2 py-1 rounded bg-white/10 hover:bg-white/20 transition-colors"
              >
                {speed}×
              </button>
              {showSpeedMenu && (
                <div className="absolute bottom-full right-0 mb-2 bg-surface-800 border border-surface-700 rounded-xl overflow-hidden shadow-xl animate-slide-up">
                  {speeds.map((s) => (
                    <button
                      key={s}
                      onClick={() => {
                        if (videoRef.current) videoRef.current.playbackRate = s;
                        setSpeed(s);
                        setShowSpeedMenu(false);
                      }}
                      className={`block w-full text-left px-4 py-2 text-sm transition-colors ${
                        speed === s
                          ? 'bg-brand-500 text-white'
                          : 'text-surface-200 hover:bg-surface-700'
                      }`}
                    >
                      {s}×
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Rotate (user side especially useful on mobile) */}
          <button
            onClick={handleRotate}
            className="text-white/70 hover:text-white transition-colors tooltip"
            data-tip="Rotate"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M7.34 6.41L.86 12.9l6.49 6.48 6.49-6.48-6.5-6.49zM3.69 12.9l3.65-3.66L11 12.9l-3.66 3.65-3.65-3.65zm15.67-6.26C17.61 4.88 15.3 4 13 4V.76L8.76 5 13 9.24V6c1.79 0 3.58.68 4.95 2.05 2.73 2.73 2.73 7.17 0 9.9C16.58 19.32 14.79 20 13 20c-.97 0-1.94-.21-2.84-.61l-1.46 1.46C10.04 21.62 11.52 22 13 22c2.3 0 4.61-.88 6.36-2.64 3.52-3.51 3.52-9.21 0-12.72z"/>
            </svg>
          </button>

          {/* Fullscreen */}
          <button
            onClick={handleFullscreen}
            className="text-white/70 hover:text-white transition-colors tooltip"
            data-tip={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          >
            {isFullscreen ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"/>
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/>
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Non-admin overlay: click anywhere to show controls */}
      {!isAdmin && (
        <div
          className="absolute inset-0 z-0"
          onClick={resetControlsTimer}
        />
      )}
    </div>
  );
});

export default VideoPlayer;
