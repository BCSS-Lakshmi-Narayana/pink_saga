import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Shield, Lock, Mail, ArrowRight, Sparkles, Eye, EyeOff } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { PARTY_HERO, LOCAL_FALLBACK, BRAND } from '../config/partyMedia';

/* ──────────────────────────────────────────────────────────────────────────
   Party decorative ribbon — BRS pink ("gulabi"), the colour the party is known
   by. Kept as three bands so the existing wave animation still reads.
   ────────────────────────────────────────────────────────────────────────── */
const TriColourRibbon = () => (
  <div className="brand-flag-wave inline-flex h-1.5 w-44 overflow-hidden rounded-full shadow-md">
    <div className="flex-1 bg-[#EC4899]" />
    <div className="flex-1 bg-white" />
    <div className="flex-1 bg-[#BE185D]" />
  </div>
);

const Login = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const userData = await login(email, password);
      if (userData?.role === 'dial100') {
        navigate('/dial-100-incident-reporting');
      } else {
        navigate('/state-map'); // state map landing
      }
    } catch (err) {
      // toast handled inside AuthContext
    } finally {
      setLoading(false);
    }
  };

  /* Pre-computed particle layout so SSR & rerenders stay stable */
  const particles = useMemo(
    () =>
      Array.from({ length: 28 }).map((_, i) => ({
        id: i,
        left: `${(i * 7 + 2) % 100}%`,
        size: 3 + ((i * 5) % 6),
        delay: `${(i * 0.6) % 10}s`,
        duration: `${7 + ((i * 2) % 8)}s`,
        drift: `${((i % 2 === 0 ? 1 : -1) * (10 + (i * 5) % 40))}px`,
        colour: i % 3 === 0 ? '#EC4899' : i % 3 === 1 ? '#F9A8D4' : '#FFFFFF',
      })),
    []
  );

  return (
    <div
      className="relative min-h-screen w-full overflow-hidden flex items-center justify-center p-4 sm:p-6"
      style={{
        background:
          'radial-gradient(circle at 15% 20%, #EC4899 0%, transparent 35%),' +
          'radial-gradient(circle at 85% 80%, #9D174D 0%, transparent 40%),' +
          'linear-gradient(135deg, #2D0616 0%, #9D174D 35%, #9D174D 65%, #DB2777 100%)',
      }}
    >
      {/* ─── rising particles ─────────────────────────────────────────── */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {particles.map((p) => (
          <span
            key={p.id}
            className="brand-particle absolute rounded-full"
            style={{
              left: p.left,
              bottom: '-10px',
              width: p.size,
              height: p.size,
              background: p.colour,
              boxShadow: `0 0 ${p.size * 2}px ${p.colour}`,
              '--particle-duration': p.duration,
              '--particle-delay': p.delay,
              '--particle-drift': p.drift,
              opacity: 0.55,
            }}
          />
        ))}
      </div>

      {/* ─── diagonal pinstripe overlay for depth ────────────────────── */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.06]"
        style={{
          backgroundImage:
            'repeating-linear-gradient(45deg, transparent 0, transparent 30px, rgba(255,255,255,0.5) 30px, rgba(255,255,255,0.5) 31px)',
        }}
      />

      {/* ─── two-column split: left portrait, right login ─────────────── */}
      <div className="relative z-10 w-full max-w-6xl">
        <div className="relative">
          {/* outer brand glow */}
          <div className="absolute -inset-[1px] rounded-3xl bg-gradient-to-br from-pink-200 via-pink-400 to-pink-700 opacity-80 blur-[2px]" aria-hidden="true" />

          <div className="relative grid grid-cols-1 lg:grid-cols-2 rounded-3xl overflow-hidden bg-white/95 backdrop-blur-xl border border-white/40 shadow-[0_25px_60px_-15px_rgba(112,26,61,0.55)]">

            {/* ───────── LEFT: leader portrait panel ───────── */}
            <div
              className="relative hidden lg:flex flex-col justify-between p-10 text-white overflow-hidden min-h-[640px]"
              style={{
                background:
                  'radial-gradient(circle at 20% 20%, rgba(236,72,153,0.55) 0%, transparent 45%),' +
                  'radial-gradient(circle at 80% 80%, rgba(157,23,77,0.6) 0%, transparent 50%),' +
                  'linear-gradient(135deg, #2D0616 0%, #9D174D 45%, #9D174D 100%)',
              }}
            >
              {/* top: ribbon + party mark */}
              <div className="relative z-10 flex items-center gap-3">
                <TriColourRibbon />
                <span className="text-[10px] font-bold tracking-[0.32em] uppercase text-pink-100/90">
                  {BRAND.partyShort} · {BRAND.stateName}
                </span>
              </div>

              {/* centre: large leader portrait */}
              <div className="relative z-10 flex flex-col items-center text-center">
                <div className="relative w-56 h-56 xl:w-64 xl:h-64 mb-6">
                  <div className="absolute inset-0 rounded-full overflow-hidden brand-glow border-[4px] border-white/95 shadow-2xl">
                    <img
                      src={PARTY_HERO.src}
                      alt={PARTY_HERO.alt}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        if (e.currentTarget.dataset.fallbackUsed) {
                          e.currentTarget.style.display = 'none';
                          return;
                        }
                        e.currentTarget.dataset.fallbackUsed = '1';
                        e.currentTarget.src = LOCAL_FALLBACK;
                      }}
                    />
                  </div>
                </div>

                <h1
                  className="text-4xl xl:text-5xl font-heading font-extrabold tracking-wider uppercase bg-clip-text text-transparent brand-gradient-shimmer"
                  style={{
                    backgroundImage:
                      'linear-gradient(90deg, #FFFFFF 0%, #FCE7F3 25%, #FFFFFF 50%, #FCE7F3 75%, #FFFFFF 100%)',
                  }}
                >
                  {BRAND.appName}
                </h1>
                <p className="mt-2 text-base text-white/95 font-semibold tracking-[0.18em] uppercase">
                  {BRAND.leaderName}
                </p>
                <p className="mt-1 text-[11px] text-pink-100/90 font-medium tracking-[0.32em] uppercase">
                  {BRAND.leaderTitle}
                </p>
                <div className="mx-auto mt-4 h-[2px] w-32 origin-center bg-gradient-to-r from-transparent via-pink-200 to-transparent brand-underline-pulse" />
                <p className="mt-4 text-sm text-white/85 max-w-sm leading-relaxed">
                  Real-time social media intelligence for the {BRAND.partyName} — mentions, sentiment, alerts &amp; grievances across {BRAND.stateName}.
                </p>
              </div>

              {/* bottom: footer tagline */}
              <div className="relative z-10 flex items-center justify-center gap-2 text-[10px] text-pink-100/90 font-semibold tracking-wider uppercase">
                <span>{BRAND.partyName}</span>
                <span className="h-1 w-1 rounded-full bg-pink-200/80" />
                <span>{BRAND.stateName}</span>
              </div>
            </div>

            {/* ───────── RIGHT: login form panel ───────── */}
            <div className="relative p-6 sm:p-10 lg:p-12 flex flex-col justify-center">
              {/* compact mobile-only hero (left panel is hidden on mobile) */}
              <div className="lg:hidden text-center mb-6">
                <div className="relative mx-auto mb-4 w-24 h-24">
                  <div className="absolute inset-0 rounded-full overflow-hidden brand-glow border-[3px] border-white/95">
                    <img
                      src={PARTY_HERO.src}
                      alt={PARTY_HERO.alt}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        if (e.currentTarget.dataset.fallbackUsed) {
                          e.currentTarget.style.display = 'none';
                          return;
                        }
                        e.currentTarget.dataset.fallbackUsed = '1';
                        e.currentTarget.src = LOCAL_FALLBACK;
                      }}
                    />
                  </div>
                </div>
                <h1 className="text-2xl font-heading font-extrabold tracking-wider uppercase text-pink-900">
                  {BRAND.appName}
                </h1>
                <p className="text-[11px] text-pink-700/80 font-medium tracking-[0.32em] uppercase mt-0.5">
                  {BRAND.leaderName}
                </p>
              </div>

              <div className="flex items-center gap-3 mb-6 pb-4 border-b border-pink-100">
                <div className="relative">
                  <div className="absolute -inset-1 rounded-xl bg-gradient-to-br from-pink-300 to-pink-500 blur-sm opacity-70" />
                  <div className="relative p-2.5 rounded-xl bg-gradient-to-br from-pink-500 to-pink-700 shadow-lg">
                    <Shield className="h-5 w-5 text-white" />
                  </div>
                </div>
                <div>
                  <h2 className="text-lg sm:text-xl font-heading font-bold text-pink-900">
                    Secure Command Access
                  </h2>
                  <p className="text-[11px] text-pink-700/80 font-medium tracking-wide">
                    {BRAND.partyUnit} · Authorised personnel only
                  </p>
                </div>
                <Sparkles className="ml-auto h-4 w-4 text-pink-500 animate-pulse" />
              </div>

              <form onSubmit={handleSubmit} className="space-y-5" data-testid="login-form">
                <div className="space-y-1.5">
                  <Label htmlFor="email" className="text-xs font-bold uppercase tracking-wider text-pink-900">
                    Email
                  </Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-pink-500/70 pointer-events-none" />
                    <Input
                      id="email"
                      type="email"
                      placeholder="Enter your email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      autoComplete="email"
                      data-testid="email-input"
                      className="h-12 pl-10 border-2 border-pink-200 bg-pink-50/30 focus:border-pink-500 focus:ring-pink-500/20 text-base rounded-lg"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="password" className="text-xs font-bold uppercase tracking-wider text-pink-900">
                    Password
                  </Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-pink-500/70 pointer-events-none" />
                    <Input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      placeholder="Enter your password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      autoComplete="current-password"
                      data-testid="password-input"
                      className="h-12 pl-10 pr-11 border-2 border-pink-200 bg-pink-50/30 focus:border-pink-500 focus:ring-pink-500/20 text-base rounded-lg"
                    />
                    {/* type="button" is required — a bare <button> inside a form
                        defaults to type="submit" and would submit on every toggle. */}
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      aria-pressed={showPassword}
                      data-testid="toggle-password-btn"
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-pink-500/70 hover:text-pink-700 focus:outline-none focus:text-pink-700 transition-colors"
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                <Button
                  type="submit"
                  disabled={loading}
                  data-testid="login-submit-btn"
                  className="group relative w-full h-12 overflow-hidden text-base font-extrabold uppercase tracking-wider text-white border-0 rounded-lg shadow-lg shadow-pink-600/40 transition-all duration-200 hover:shadow-xl hover:shadow-pink-600/50 active:scale-[0.985] disabled:opacity-75"
                  style={{
                    background:
                      'linear-gradient(90deg, #9D174D 0%, #DB2777 35%, #EC4899 65%, #F9A8D4 100%)',
                    backgroundSize: '200% 100%',
                    animation: 'brandGradientShimmer 4s linear infinite',
                  }}
                >
                  <span className="relative z-10 flex items-center justify-center gap-2">
                    {loading ? (
                      <>
                        <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                        Authenticating…
                      </>
                    ) : (
                      <>
                        <Shield className="h-4 w-4" />
                        Enter Command Centre
                        <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                      </>
                    )}
                  </span>
                </Button>
              </form>

              {/* Three quick reassurance pills */}
              <div className="mt-5 grid grid-cols-3 gap-2 text-[10px] sm:text-[11px] font-semibold uppercase tracking-wide">
                <div className="flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md bg-pink-50 text-pink-700 border border-pink-100">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Encrypted
                </div>
                <div className="flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md bg-pink-50 text-pink-800 border border-pink-100">
                  <span className="h-1.5 w-1.5 rounded-full bg-pink-500 animate-pulse" />
                  24×7 Watch
                </div>
                <div className="flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md bg-rose-50 text-rose-700 border border-rose-100">
                  <span className="h-1.5 w-1.5 rounded-full bg-rose-500 animate-pulse" />
                  Audit-Logged
                </div>
              </div>

              <p className="mt-6 text-center text-[10px] text-pink-700/60">
                © {new Date().getFullYear()} {BRAND.appName} · Secure intelligence platform
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;
