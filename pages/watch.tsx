import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import { io, Socket } from 'socket.io-client';
import VideoPlayer, { VideoPlayerHandle } from '@/components/VideoPlayer';

interface Me {
  id: number;
  username: string;
  role: 'admin' | 'user';
  displayName: string | null;
}

interface ConnectedUser {
  username: string;
  role: string;
  socketId: string;
}

interface ChatMessage {
  id: string;
  username: string;
  text: string;
  ts: number;
}

interface SessionState {
  videoUrl: string;
  isPlaying: boolean;
  currentTime: number;
  timestamp: number;
  users: ConnectedUser[];
  videoDuration?: number;
}

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    // Free TURN servers for NAT traversal (works behind firewalls/symmetric NAT)
    {
      urls: 'turn:openrelay.metered.ca:80',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
    {
      urls: 'turn:openrelay.metered.ca:443',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
    {
      urls: 'turn:openrelay.metered.ca:443?transport=tcp',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
  ],
  iceCandidatePoolSize: 10,
};

export default function WatchPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [videoUrl, setVideoUrl] = useState('');
  const [connectedUsers, setConnectedUsers] = useState<ConnectedUser[]>([]);
  const [videoDuration, setVideoDuration] = useState(0);
  const [voiceActive, setVoiceActive] = useState(false);  // true = user has started their mic
  const [micMuted, setMicMuted] = useState(false);
  const [peerConnected, setPeerConnected] = useState(false); // true = WebRTC PC is connected
  const [voiceStatus, setVoiceStatus] = useState('');
  const [syncStatus, setSyncStatus] = useState('');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [chatUnread, setChatUnread] = useState(0);

  const playerRef = useRef<VideoPlayerHandle>(null);
  const socketRef = useRef<Socket | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const peerConnsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatOpenRef = useRef(false);

  // ── Auth ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((data) => {
        if (data.error) { router.push('/'); return; }
        setMe(data);
      })
      .catch(() => router.push('/'));
  }, [router]);

  // ── Socket.io ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!me) return;

    const socket = io({ transports: ['websocket', 'polling'] });
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('auth', { username: me.username, role: me.role });
    });

    // Receive full session state (on join or URL change)
    socket.on('session:state', (state: SessionState) => {
      setVideoUrl(state.videoUrl);
      setConnectedUsers(state.users);
      if (state.videoDuration) setVideoDuration(state.videoDuration);

      if (me.role === 'user' && state.videoUrl) {
        const elapsed = (Date.now() - state.timestamp) / 1000;
        const targetTime = state.isPlaying ? state.currentTime + elapsed : state.currentTime;

        // Wait for video element to be ready, then sync
        setTimeout(() => {
          const p = playerRef.current;
          if (!p) return;
          if (targetTime > 1) p.seek(targetTime);
          if (state.isPlaying) p.play(); else p.pause();
          setSyncStatus('Synced');
          setTimeout(() => setSyncStatus(''), 2000);
        }, 1500);
      }
    });

    // Duration arrives from ffprobe (may come after session:state)
    socket.on('video:duration', ({ duration }: { duration: number }) => {
      setVideoDuration(duration);
    });

    socket.on('room:users', (users: ConnectedUser[]) => {
      setConnectedUsers(users);
    });

    // Admin → user video events
    if (me.role === 'user') {
      socket.on('video:play', ({ currentTime, timestamp }: { currentTime: number; timestamp: number }) => {
        const p = playerRef.current;
        if (!p) return;
        const elapsed = (Date.now() - timestamp) / 1000;
        p.seek(currentTime + elapsed);
        p.play();
        setSyncStatus('▶ Play');
        setTimeout(() => setSyncStatus(''), 1500);
      });

      socket.on('video:pause', ({ currentTime }: { currentTime: number }) => {
        const p = playerRef.current;
        if (!p) return;
        p.seek(currentTime);
        p.pause();
        setSyncStatus('⏸ Pause');
        setTimeout(() => setSyncStatus(''), 1500);
      });

      socket.on('video:seek', ({ currentTime, timestamp }: { currentTime: number; timestamp: number }) => {
        const p = playerRef.current;
        if (!p) return;
        const elapsed = (Date.now() - timestamp) / 1000;
        p.seek(currentTime + elapsed * 0.5);
        setSyncStatus('⏩ Seek');
        setTimeout(() => setSyncStatus(''), 1500);
      });

      // Periodic heartbeat sync — correct drift if > 5s out of sync
      socket.on('video:heartbeat', ({ currentTime: adminTime }: { currentTime: number }) => {
        const p = playerRef.current;
        if (!p) return;
        const myTime = p.getCurrentTime();
        if (Math.abs(myTime - adminTime) > 5) {
          p.seek(adminTime);
          setSyncStatus('Re-synced');
          setTimeout(() => setSyncStatus(''), 1500);
        }
      });
    }

    // WebRTC: new peer joined (call them) — always create PC even without mic
    socket.on('webrtc:peer-joined', async ({ peerId, username: peerName }: { peerId: string; username: string }) => {
      setVoiceStatus(`${peerName} joined`);
      const pc = createPeerConnection(peerId, socket);
      peerConnsRef.current.set(peerId, pc);

      try {
        const offer = await pc.createOffer({ offerToReceiveAudio: true });
        await pc.setLocalDescription(offer);
        socket.emit('webrtc:offer', { targetId: peerId, offer });
      } catch (err) {
        console.error('Offer error', err);
      }
    });

    socket.on('webrtc:offer', async ({ fromId, offer }: { fromId: string; offer: RTCSessionDescriptionInit }) => {
      let pc = peerConnsRef.current.get(fromId);
      if (!pc) {
        pc = createPeerConnection(fromId, socket);
        peerConnsRef.current.set(fromId, pc);
      }

      try {
        // Handle renegotiation glare: if we also sent an offer, rollback first
        if (pc.signalingState !== 'stable') {
          await Promise.all([
            pc.setLocalDescription({ type: 'rollback' }),
            pc.setRemoteDescription(offer),
          ]);
        } else {
          await pc.setRemoteDescription(offer);
        }
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('webrtc:answer', { targetId: fromId, answer });
      } catch (err) {
        console.error('Answer/renegotiation error', err);
      }
    });

    socket.on('webrtc:answer', async ({ fromId, answer }: { fromId: string; answer: RTCSessionDescriptionInit }) => {
      const pc = peerConnsRef.current.get(fromId);
      if (pc) {
        try {
          await pc.setRemoteDescription(answer);
        } catch (err) {
          console.error('Set answer error', err);
        }
      }
    });

    socket.on('webrtc:ice', async ({ fromId, candidate }: { fromId: string; candidate: RTCIceCandidateInit }) => {
      const pc = peerConnsRef.current.get(fromId);
      if (pc) {
        try {
          await pc.addIceCandidate(candidate);
        } catch (err) {
          console.error('ICE error', err);
        }
      }
    });

    // Kicked off because same account opened on another device
    socket.on('session:kick', () => {
      router.push('/?kicked=1');
    });

    socket.on('chat:message', (msg: ChatMessage) => {
      setChatMessages((prev) => [...prev, msg]);
      if (!chatOpenRef.current) setChatUnread((n) => n + 1);
    });

    socket.on('webrtc:peer-left', ({ peerId }: { peerId: string }) => {
      const pc = peerConnsRef.current.get(peerId);
      if (pc) { pc.close(); peerConnsRef.current.delete(peerId); }
      setVoiceStatus('Peer disconnected');
      setTimeout(() => setVoiceStatus(''), 2000);
    });

    // Admin heartbeat (periodic time sync for users)
    if (me.role === 'admin') {
      heartbeatRef.current = setInterval(() => {
        const t = playerRef.current?.getCurrentTime() ?? 0;
        socket.emit('video:heartbeat', { currentTime: t });
      }, 5000);
    }

    return () => {
      socket.disconnect();
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      peerConnsRef.current.forEach((pc) => pc.close());
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, [me]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── WebRTC helpers ────────────────────────────────────────────────────────
  function createPeerConnection(peerId: string, socket: Socket): RTCPeerConnection {
    const pc = new RTCPeerConnection(ICE_SERVERS);

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => {
        pc.addTrack(track, localStreamRef.current!);
      });
    }

    pc.ontrack = (event) => {
      // Use a persistent <audio> element (iOS Safari blocks new Audio() autoplay)
      let audio = document.getElementById('remote-audio') as HTMLAudioElement;
      if (!audio) {
        audio = document.createElement('audio');
        audio.id = 'remote-audio';
        audio.autoplay = true;
        audio.setAttribute('playsinline', '');
        document.body.appendChild(audio);
      }
      audio.srcObject = event.streams[0];
      // iOS Safari needs play() inside a user-gesture chain; catch + retry
      audio.play().catch(() => {
        const resume = () => {
          audio.play().catch(console.error);
          document.removeEventListener('touchstart', resume);
          document.removeEventListener('click', resume);
        };
        document.addEventListener('touchstart', resume, { once: true });
        document.addEventListener('click', resume, { once: true });
      });
      setVoiceStatus('Voice connected');
      setTimeout(() => setVoiceStatus(''), 2000);
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('webrtc:ice', { targetId: peerId, candidate: event.candidate });
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        setPeerConnected(true);
        setVoiceStatus('Peer connected — tap mic to talk');
        setTimeout(() => setVoiceStatus(''), 3000);
      } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        setPeerConnected(false);
        setVoiceStatus('Voice disconnected');
        setTimeout(() => setVoiceStatus(''), 2000);
      }
    };

    return pc;
  }

  // ── Voice chat toggle ─────────────────────────────────────────────────────
  const handleToggleMic = useCallback(async () => {
    // No local stream yet → start mic for the first time
    if (!localStreamRef.current) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        localStreamRef.current = stream;
        setVoiceActive(true);
        setMicMuted(false);
        setVoiceStatus('Mic on — connecting…');

        // Add audio track to ALL existing peer connections and renegotiate
        for (const [peerId, pc] of peerConnsRef.current.entries()) {
          stream.getTracks().forEach((track) => pc.addTrack(track, stream));
          try {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            socketRef.current?.emit('webrtc:offer', { targetId: peerId, offer: pc.localDescription });
          } catch (err) {
            console.error('Renegotiation error for', peerId, err);
          }
        }
        setTimeout(() => setVoiceStatus(''), 2000);
      } catch {
        setVoiceStatus('Microphone access denied');
        setTimeout(() => setVoiceStatus(''), 3000);
      }
      return;
    }

    // Already have mic → toggle mute/unmute
    if (micMuted) {
      localStreamRef.current.getTracks().forEach((t) => { t.enabled = true; });
      setMicMuted(false);
    } else {
      localStreamRef.current.getTracks().forEach((t) => { t.enabled = false; });
      setMicMuted(true);
    }
  }, [micMuted]);

  // ── Chat helpers ──────────────────────────────────────────────────────────
  useEffect(() => {
    chatOpenRef.current = chatOpen;
    if (chatOpen) {
      setChatUnread(0);
      setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    }
  }, [chatOpen]);

  useEffect(() => {
    if (chatOpen) chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages, chatOpen]);

  function handleSendChat(e: React.FormEvent) {
    e.preventDefault();
    if (!chatInput.trim()) return;
    socketRef.current?.emit('chat:message', { text: chatInput.trim() });
    setChatInput('');
  }

  function formatTime(ts: number) {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  // ── Admin video event emitters ────────────────────────────────────────────
  const handlePlay = useCallback((currentTime: number) => {
    socketRef.current?.emit('video:play', { currentTime });
  }, []);

  const handlePause = useCallback((currentTime: number) => {
    socketRef.current?.emit('video:pause', { currentTime });
  }, []);

  const handleSeek = useCallback((currentTime: number) => {
    socketRef.current?.emit('video:seek', { currentTime });
  }, []);

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/');
  };

  if (!me) {
    return (
      <div className="min-h-screen bg-surface-950 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>CinemaSync — Watch</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#09090b" />
      </Head>

      <div className="min-h-screen bg-surface-950 flex flex-col">
        {/* Top bar */}
        <header className="flex-shrink-0 border-b border-surface-800/60 bg-surface-900/70 backdrop-blur z-50">
          <div className="max-w-7xl mx-auto px-4 h-12 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-6 h-6 rounded-md bg-brand-500 flex items-center justify-center flex-shrink-0">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="white">
                  <path d="M8 6.82v10.36c0 .79.87 1.27 1.54.84l8.14-5.18c.62-.39.62-1.29 0-1.69L9.54 5.98C8.87 5.55 8 6.03 8 6.82z" />
                </svg>
              </div>
              <span className="font-bold text-white text-sm">CinemaSync</span>
              <span
                className={`text-xs font-semibold px-2 py-0.5 rounded-full text-white ${me.role === 'admin' ? 'badge-admin' : 'badge-user'}`}
              >
                {me.role === 'admin' ? '⚡ ADMIN' : '👁 VIEWER'}
              </span>
            </div>

            <div className="flex items-center gap-3 text-xs">
              {/* Sync status */}
              {syncStatus && (
                <span className="text-brand-400 font-medium animate-fade-in">{syncStatus}</span>
              )}
              {/* Voice status */}
              {voiceStatus && (
                <span className="text-green-400 font-medium animate-fade-in">{voiceStatus}</span>
              )}

              {/* Online indicator */}
              <div className="flex items-center gap-1.5 bg-surface-800 rounded-full px-2.5 py-1">
                <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse-slow" />
                <span className="text-surface-300">
                  {connectedUsers.length} online
                </span>
              </div>

              {/* Admin link */}
              {me.role === 'admin' && (
                <Link href="/admin">
                  <span className="text-surface-400 hover:text-white transition-colors cursor-pointer">
                    Dashboard
                  </span>
                </Link>
              )}

              <button
                onClick={handleLogout}
                className="text-surface-500 hover:text-white transition-colors"
              >
                Sign out
              </button>
            </div>
          </div>
        </header>

        {/* Main content */}
        <main className="flex-1 flex flex-col items-center justify-center px-2 py-4 sm:px-4">
          {/* Video container */}
          <div className="w-full max-w-5xl">
            <VideoPlayer
              ref={playerRef}
              src={videoUrl}
              isAdmin={me.role === 'admin'}
              videoDuration={videoDuration}
              onPlay={handlePlay}
              onPause={handlePause}
              onSeek={handleSeek}
              connectedUsers={connectedUsers}
              voiceActive={voiceActive}
              isMuted={micMuted}
              onToggleMic={handleToggleMic}
            />
          </div>

          {/* Info row */}
          <div className="w-full max-w-5xl mt-4 flex flex-wrap items-center justify-between gap-3 px-1">
            {/* Who's watching */}
            <div className="flex items-center gap-2 flex-wrap">
              {connectedUsers.map((u) => (
                <div key={u.socketId} className="flex items-center gap-1.5 bg-surface-800 rounded-full pl-1 pr-3 py-1">
                  <div
                    className="w-5 h-5 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                    style={{
                      background:
                        u.role === 'admin'
                          ? 'linear-gradient(135deg,#6366f1,#8b5cf6)'
                          : 'linear-gradient(135deg,#0ea5e9,#06b6d4)',
                    }}
                  >
                    {u.username.charAt(0).toUpperCase()}
                  </div>
                  <span className="text-surface-300 text-xs">
                    {u.username}
                    {u.username === me.username ? ' (you)' : ''}
                  </span>
                </div>
              ))}
            </div>

            {/* Keyboard shortcuts hint */}
            <div className="text-surface-600 text-xs hidden sm:block">
              {me.role === 'admin'
                ? 'Space/K · ← → seek · ↑↓ volume · F fullscreen'
                : '↑↓ volume · F fullscreen · M mute'}
            </div>
          </div>

          {/* Admin: no video URL notice */}
          {me.role === 'admin' && !videoUrl && (
            <div className="w-full max-w-5xl mt-4">
              <div className="flex items-start gap-3 bg-surface-800/60 border border-surface-700 rounded-xl px-4 py-3">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="#6366f1" className="flex-shrink-0 mt-0.5">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
                </svg>
                <p className="text-surface-300 text-sm">
                  No video loaded. Go to{' '}
                  <Link href="/admin">
                    <span className="text-brand-400 hover:underline cursor-pointer">Admin Dashboard</span>
                  </Link>{' '}
                  → Session tab to paste a video URL, then come back here.
                </p>
              </div>
            </div>
          )}

          {/* User: waiting notice */}
          {me.role === 'user' && !videoUrl && (
            <div className="w-full max-w-5xl mt-4">
              <div className="flex items-center gap-3 bg-surface-800/60 border border-surface-700 rounded-xl px-4 py-3">
                <div className="w-4 h-4 border-2 border-brand-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />
                <p className="text-surface-300 text-sm">
                  Waiting for admin to load a movie…
                </p>
              </div>
            </div>
          )}
        </main>

        {/* ── Chat button (floating) ── */}
        <button
          onClick={() => setChatOpen((o) => !o)}
          className="fixed bottom-5 right-5 z-50 w-12 h-12 rounded-full bg-brand-500 hover:bg-brand-600 shadow-lg flex items-center justify-center transition-all"
          aria-label="Toggle chat"
        >
          {chatUnread > 0 && !chatOpen && (
            <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-red-500 text-white text-xs flex items-center justify-center font-bold">
              {chatUnread > 9 ? '9+' : chatUnread}
            </span>
          )}
          {chatOpen ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="white">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="white">
              <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/>
            </svg>
          )}
        </button>

        {/* ── Chat panel ── */}
        {chatOpen && (
          <div className="fixed bottom-20 right-5 z-50 w-80 max-w-[calc(100vw-2.5rem)] flex flex-col rounded-2xl overflow-hidden shadow-2xl border border-surface-700" style={{ height: '420px', background: 'rgba(9,9,11,0.97)', backdropFilter: 'blur(12px)' }}>
            {/* Chat header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-surface-700 flex-shrink-0">
              <span className="text-white text-sm font-semibold">💬 Chat</span>
              <button onClick={() => setChatOpen(false)} className="text-surface-400 hover:text-white transition-colors">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                </svg>
              </button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0">
              {chatMessages.length === 0 && (
                <p className="text-surface-500 text-xs text-center mt-4">No messages yet. Say hi! 👋</p>
              )}
              {chatMessages.map((msg) => {
                const isMe = msg.username === me.username;
                return (
                  <div key={msg.id} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                    <div className={`flex items-center gap-1.5 mb-0.5 ${isMe ? 'flex-row-reverse' : ''}`}>
                      <span className="text-xs font-medium" style={{ color: isMe ? '#818cf8' : '#38bdf8' }}>
                        {isMe ? 'You' : msg.username}
                      </span>
                      <span className="text-surface-600 text-xs">{formatTime(msg.ts)}</span>
                    </div>
                    <div
                      className={`max-w-[85%] px-3 py-2 rounded-2xl text-sm break-words ${
                        isMe
                          ? 'bg-brand-500 text-white rounded-tr-sm'
                          : 'bg-surface-700 text-surface-100 rounded-tl-sm'
                      }`}
                    >
                      {msg.text}
                    </div>
                  </div>
                );
              })}
              <div ref={chatEndRef} />
            </div>

            {/* Input */}
            <form onSubmit={handleSendChat} className="flex items-center gap-2 px-3 py-3 border-t border-surface-700 flex-shrink-0">
              <input
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Type a message…"
                maxLength={500}
                className="flex-1 bg-surface-800 border border-surface-700 rounded-xl px-3 py-2 text-white text-sm placeholder-surface-500 focus:border-brand-500 focus:outline-none transition-colors"
              />
              <button
                type="submit"
                disabled={!chatInput.trim()}
                className="w-9 h-9 rounded-xl bg-brand-500 hover:bg-brand-600 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center transition-colors flex-shrink-0"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
                  <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
                </svg>
              </button>
            </form>
          </div>
        )}
      </div>
    </>
  );
}
