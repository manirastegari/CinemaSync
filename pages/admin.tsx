import { useState, useEffect, useRef, FormEvent } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import { io, Socket } from 'socket.io-client';

interface User {
  id: number;
  username: string;
  role: 'admin' | 'user';
  display_name: string | null;
  created_at: string;
  last_login: string | null;
}

interface Me {
  id: number;
  username: string;
  role: 'admin' | 'user';
  displayName: string | null;
}

export default function AdminPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [sessionUrl, setSessionUrl] = useState('');
  const [urlInput, setUrlInput] = useState('');
  const [tab, setTab] = useState<'session' | 'users'>('session');

  // Create user form
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newDisplayName, setNewDisplayName] = useState('');
  const [createError, setCreateError] = useState('');
  const [createSuccess, setCreateSuccess] = useState('');
  const [createLoading, setCreateLoading] = useState(false);

  // Password reset
  const [resetTargetId, setResetTargetId] = useState<number | null>(null);
  const [resetPassword, setResetPassword] = useState('');

  // URL save
  const [urlSaving, setUrlSaving] = useState(false);
  const [urlSaved, setUrlSaved] = useState(false);

  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((data) => {
        if (data.error) { router.push('/'); return; }
        if (data.role !== 'admin') { router.push('/watch'); return; }
        setMe(data);
        const socket = io({ transports: ['websocket', 'polling'] });
        socketRef.current = socket;
        socket.on('connect', () => {
          socket.emit('auth', { username: data.username, role: data.role });
        });
      })
      .catch(() => router.push('/'));

    return () => { socketRef.current?.disconnect(); };
  }, [router]);

  useEffect(() => {
    if (!me) return;
    fetch('/api/admin/users')
      .then((r) => r.json())
      .then(setUsers)
      .catch(console.error);

    fetch('/api/admin/session')
      .then((r) => r.json())
      .then((d) => {
        setSessionUrl(d.url || '');
        setUrlInput(d.url || '');
      })
      .catch(console.error);
  }, [me]);

  async function handleSaveUrl(e: FormEvent) {
    e.preventDefault();
    setUrlSaving(true);
    setUrlSaved(false);
    try {
      await fetch('/api/admin/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: urlInput.trim() }),
      });
      setSessionUrl(urlInput.trim());
      socketRef.current?.emit('video:url-change', { url: urlInput.trim() });
      setUrlSaved(true);
      setTimeout(() => setUrlSaved(false), 3000);
    } finally {
      setUrlSaving(false);
    }
  }

  async function handleCreateUser(e: FormEvent) {
    e.preventDefault();
    setCreateError('');
    setCreateSuccess('');
    setCreateLoading(true);
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: newUsername.trim().toLowerCase(),
          password: newPassword,
          displayName: newDisplayName.trim() || newUsername.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setCreateError(data.error || 'Failed to create user.');
      } else {
        setUsers((prev) => [...prev, data]);
        setCreateSuccess(`User "${data.username}" created successfully.`);
        setNewUsername('');
        setNewPassword('');
        setNewDisplayName('');
      }
    } finally {
      setCreateLoading(false);
    }
  }

  async function handleDeleteUser(id: number, username: string) {
    if (!confirm(`Delete user "${username}"? This cannot be undone.`)) return;
    await fetch('/api/admin/users', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    setUsers((prev) => prev.filter((u) => u.id !== id));
  }

  async function handleResetPassword(id: number) {
    if (!resetPassword) return;
    await fetch('/api/admin/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, password: resetPassword }),
    });
    setResetTargetId(null);
    setResetPassword('');
    alert('Password updated successfully.');
  }

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/');
  }

  function formatDate(dt: string | null) {
    if (!dt) return 'Never';
    return new Date(dt).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

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
        <title>CinemaSync — Admin</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <div className="min-h-screen bg-surface-950">
        {/* Header */}
        <header className="border-b border-surface-800 bg-surface-900/80 backdrop-blur sticky top-0 z-50">
          <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-7 h-7 rounded-lg bg-brand-500 flex items-center justify-center">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
                  <path d="M8 6.82v10.36c0 .79.87 1.27 1.54.84l8.14-5.18c.62-.39.62-1.29 0-1.69L9.54 5.98C8.87 5.55 8 6.03 8 6.82z" />
                </svg>
              </div>
              <span className="font-bold text-white">CinemaSync</span>
              <span className="text-xs font-medium px-2 py-0.5 rounded-full badge-admin text-white">Admin</span>
            </div>
            <div className="flex items-center gap-3">
              <Link href="/watch">
                <button className="flex items-center gap-2 bg-brand-500 hover:bg-brand-600 text-white text-sm font-medium px-4 py-1.5 rounded-lg transition-colors">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M8 6.82v10.36c0 .79.87 1.27 1.54.84l8.14-5.18c.62-.39.62-1.29 0-1.69L9.54 5.98C8.87 5.55 8 6.03 8 6.82z" />
                  </svg>
                  Open Player
                </button>
              </Link>
              <button
                onClick={handleLogout}
                className="text-surface-400 hover:text-white text-sm transition-colors"
              >
                Sign out
              </button>
            </div>
          </div>
        </header>

        <main className="max-w-5xl mx-auto px-4 py-8">
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-white">Dashboard</h1>
            <p className="text-surface-400 text-sm mt-1">Manage your movie session and viewer accounts.</p>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 mb-8 bg-surface-800 p-1 rounded-xl w-fit">
            {(['session', 'users'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-5 py-2 rounded-lg text-sm font-medium transition-all ${
                  tab === t
                    ? 'bg-brand-500 text-white shadow'
                    : 'text-surface-400 hover:text-white'
                }`}
              >
                {t === 'session' ? '🎬 Session' : '👥 Users'}
              </button>
            ))}
          </div>

          {/* ── Session Tab ── */}
          {tab === 'session' && (
            <div className="grid gap-6">
              <div className="glass-card rounded-2xl p-6">
                <h2 className="text-lg font-semibold text-white mb-1">Active Video URL</h2>
                <p className="text-surface-400 text-sm mb-5">
                  Set the video link that will be played for all viewers. Supports direct .mp4 / .mkv / .webm links.
                </p>
                <form onSubmit={handleSaveUrl} className="space-y-4">
                  <textarea
                    value={urlInput}
                    onChange={(e) => setUrlInput(e.target.value)}
                    placeholder="https://example.com/movie.mp4"
                    rows={3}
                    className="w-full bg-surface-800 border border-surface-700 rounded-xl px-4 py-3 text-white placeholder-surface-500 focus:border-brand-500 transition-colors text-sm font-mono resize-none"
                  />
                  <div className="flex items-center gap-3">
                    <button
                      type="submit"
                      disabled={urlSaving || urlInput.trim() === sessionUrl}
                      className="bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors flex items-center gap-2"
                    >
                      {urlSaving ? (
                        <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      ) : (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M17 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V7l-4-4zm-5 16c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm3-10H5V5h10v4z"/>
                        </svg>
                      )}
                      Save URL
                    </button>
                    {urlSaved && (
                      <span className="text-green-400 text-sm flex items-center gap-1">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                        </svg>
                        Saved! Open the player and go watch.
                      </span>
                    )}
                  </div>
                </form>

                {sessionUrl && (
                  <div className="mt-5 p-4 bg-surface-800 rounded-xl">
                    <p className="text-xs text-surface-400 mb-1 font-medium">CURRENT ACTIVE URL</p>
                    <p className="text-sm text-brand-400 font-mono break-all">{sessionUrl}</p>
                  </div>
                )}
              </div>

              <div className="glass-card rounded-2xl p-6">
                <h2 className="text-lg font-semibold text-white mb-4">Quick Tips</h2>
                <ul className="space-y-3 text-sm text-surface-300">
                  <li className="flex gap-3">
                    <span className="text-brand-400 mt-0.5">→</span>
                    <span>Open the player page to start watching. Your girlfriend opens the same link and logs in with her credentials.</span>
                  </li>
                  <li className="flex gap-3">
                    <span className="text-brand-400 mt-0.5">→</span>
                    <span>As admin you control play/pause/seek. She can adjust her own volume, rotate, and go fullscreen locally.</span>
                  </li>
                  <li className="flex gap-3">
                    <span className="text-brand-400 mt-0.5">→</span>
                    <span>Click the mic button in the player to start voice chat — browser will ask for microphone permission.</span>
                  </li>
                  <li className="flex gap-3">
                    <span className="text-brand-400 mt-0.5">→</span>
                    <span>For best H.265/MKV playback use Chrome on macOS (Apple Silicon) or Safari.</span>
                  </li>
                </ul>
              </div>
            </div>
          )}

          {/* ── Users Tab ── */}
          {tab === 'users' && (
            <div className="grid gap-6">
              {/* Create user */}
              <div className="glass-card rounded-2xl p-6">
                <h2 className="text-lg font-semibold text-white mb-1">Add New User</h2>
                <p className="text-surface-400 text-sm mb-5">Create a login for your viewing partner.</p>
                <form onSubmit={handleCreateUser} className="grid sm:grid-cols-3 gap-3">
                  <input
                    value={newUsername}
                    onChange={(e) => setNewUsername(e.target.value)}
                    placeholder="Username"
                    required
                    className="bg-surface-800 border border-surface-700 rounded-xl px-4 py-2.5 text-white placeholder-surface-500 focus:border-brand-500 text-sm transition-colors"
                  />
                  <input
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Password"
                    type="password"
                    required
                    className="bg-surface-800 border border-surface-700 rounded-xl px-4 py-2.5 text-white placeholder-surface-500 focus:border-brand-500 text-sm transition-colors"
                  />
                  <input
                    value={newDisplayName}
                    onChange={(e) => setNewDisplayName(e.target.value)}
                    placeholder="Display name (optional)"
                    className="bg-surface-800 border border-surface-700 rounded-xl px-4 py-2.5 text-white placeholder-surface-500 focus:border-brand-500 text-sm transition-colors"
                  />
                  <button
                    type="submit"
                    disabled={createLoading}
                    className="sm:col-span-3 bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-white text-sm font-medium py-2.5 rounded-xl transition-colors flex items-center justify-center gap-2"
                  >
                    {createLoading ? (
                      <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : (
                      <>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
                        </svg>
                        Create User
                      </>
                    )}
                  </button>
                </form>
                {createError && (
                  <p className="mt-3 text-red-400 text-sm">{createError}</p>
                )}
                {createSuccess && (
                  <p className="mt-3 text-green-400 text-sm">{createSuccess}</p>
                )}
              </div>

              {/* User list */}
              <div className="glass-card rounded-2xl overflow-hidden">
                <div className="px-6 py-4 border-b border-surface-700">
                  <h2 className="text-lg font-semibold text-white">
                    All Users <span className="text-surface-500 text-base font-normal ml-1">({users.length})</span>
                  </h2>
                </div>
                <div className="divide-y divide-surface-700">
                  {users.map((u) => (
                    <div key={u.id} className="px-6 py-4 flex items-center justify-between gap-4 hover:bg-surface-800/50 transition-colors">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-bold flex-shrink-0"
                          style={{ background: u.role === 'admin' ? 'linear-gradient(135deg,#6366f1,#8b5cf6)' : 'linear-gradient(135deg,#0ea5e9,#06b6d4)' }}>
                          {(u.display_name || u.username).charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-white text-sm font-medium">{u.display_name || u.username}</span>
                            <span className={`text-xs px-2 py-0.5 rounded-full text-white ${u.role === 'admin' ? 'badge-admin' : 'badge-user'}`}>
                              {u.role}
                            </span>
                          </div>
                          <div className="text-surface-400 text-xs mt-0.5">
                            @{u.username} · Last login: {formatDate(u.last_login)}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 flex-shrink-0">
                        {resetTargetId === u.id ? (
                          <div className="flex items-center gap-2">
                            <input
                              type="password"
                              value={resetPassword}
                              onChange={(e) => setResetPassword(e.target.value)}
                              placeholder="New password"
                              className="bg-surface-700 border border-surface-600 rounded-lg px-3 py-1.5 text-white text-xs w-36"
                            />
                            <button
                              onClick={() => handleResetPassword(u.id)}
                              className="bg-brand-500 text-white text-xs px-3 py-1.5 rounded-lg hover:bg-brand-600 transition-colors"
                            >Save</button>
                            <button
                              onClick={() => { setResetTargetId(null); setResetPassword(''); }}
                              className="text-surface-400 text-xs px-2 py-1.5 hover:text-white"
                            >Cancel</button>
                          </div>
                        ) : (
                          <>
                            <button
                              onClick={() => setResetTargetId(u.id)}
                              className="text-surface-400 hover:text-white text-xs px-3 py-1.5 rounded-lg border border-surface-700 hover:border-surface-500 transition-colors"
                            >
                              Reset Password
                            </button>
                            {u.id !== me.id && (
                              <button
                                onClick={() => handleDeleteUser(u.id, u.username)}
                                className="text-red-400 hover:text-red-300 text-xs px-3 py-1.5 rounded-lg border border-red-500/20 hover:border-red-500/50 transition-colors"
                              >
                                Delete
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                  {users.length === 0 && (
                    <div className="px-6 py-10 text-center text-surface-500 text-sm">
                      No users yet. Create one above.
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </>
  );
}
