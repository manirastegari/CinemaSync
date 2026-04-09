import { useState, FormEvent, useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [kicked, setKicked] = useState(false);

  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (router.query.kicked) setKicked(true);
  }, [router.query]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Login failed.');
        setLoading(false);
        return;
      }
      if (data.role === 'admin') {
        router.push('/admin');
      } else {
        router.push('/watch');
      }
    } catch {
      setError('Network error. Please try again.');
      setLoading(false);
    }
  }

  return (
    <>
      <Head>
        <title>CinemaSync — Sign In</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <div className="min-h-screen bg-surface-950 flex items-center justify-center px-4">
        {/* Background glow */}
        <div
          className="fixed inset-0 pointer-events-none"
          style={{
            background:
              'radial-gradient(ellipse 60% 50% at 50% 0%, rgba(99,102,241,0.12) 0%, transparent 70%)',
          }}
        />

        <div className="relative z-10 w-full max-w-md">
          {/* Logo */}
          <div className="text-center mb-10">
            <div className="inline-flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-brand-500 flex items-center justify-center shadow-lg shadow-brand-500/30">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="white">
                  <path d="M8 6.82v10.36c0 .79.87 1.27 1.54.84l8.14-5.18c.62-.39.62-1.29 0-1.69L9.54 5.98C8.87 5.55 8 6.03 8 6.82z" />
                </svg>
              </div>
              <span className="text-2xl font-bold text-white tracking-tight">CinemaSync</span>
            </div>
            <p className="text-surface-400 text-sm">Watch together, from anywhere.</p>
            <span className="inline-block mt-2 text-surface-600 text-xs font-mono">
              v{process.env.NEXT_PUBLIC_APP_VERSION}
            </span>
          </div>

          {/* Card */}
          <div className="glass-card rounded-2xl p-8">
            {kicked && (
            <div className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-3 mb-5">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="#fbbf24">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
              </svg>
              <span className="text-amber-400 text-sm">Signed out — your account was opened on another device.</span>
            </div>
          )}
          <h1 className="text-xl font-semibold text-white mb-6">Sign in to continue</h1>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-surface-300 mb-2">
                  Username
                </label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Enter your username"
                  required
                  autoFocus
                  className="w-full bg-surface-800 border border-surface-700 rounded-xl px-4 py-3 text-white placeholder-surface-500 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 transition-colors text-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-surface-300 mb-2">
                  Password
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  required
                  className="w-full bg-surface-800 border border-surface-700 rounded-xl px-4 py-3 text-white placeholder-surface-500 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 transition-colors text-sm"
                />
              </div>

              {error && (
                <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="#f87171">
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" />
                  </svg>
                  <span className="text-red-400 text-sm">{error}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-brand-500 hover:bg-brand-600 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl transition-all duration-200 flex items-center justify-center gap-2 mt-2"
              >
                {loading ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Signing in…
                  </>
                ) : (
                  'Sign In'
                )}
              </button>
            </form>
          </div>

          <p className="text-center text-surface-500 text-xs mt-6">
            Contact your admin for access credentials.
          </p>
        </div>
      </div>
    </>
  );
}
