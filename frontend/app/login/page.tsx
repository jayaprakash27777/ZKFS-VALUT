/**
 * app/login/page.tsx
 *
 * Zero-Knowledge Login — Premium UI
 * KEK is derived via Argon2id in-browser and stored only in RAM.
 */

'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { useRouter }         from 'next/navigation';
import Link                  from 'next/link';
import { motion }            from 'framer-motion';
import {
  Lock, Shield, ArrowRight, Loader2, AlertCircle, Eye, EyeOff,
  ShieldCheck, Fingerprint, Key, QrCode
} from 'lucide-react';
import { useAuth }           from '@/hooks/useAuth';
import { usePasskeys }       from '@/hooks/usePasskeys';

// ── Animated background blobs ────────────────────────────────────────────────
function BackgroundBlobs() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none bg-[#030303]" aria-hidden>
      {/* Top right violet blob */}
      <motion.div
        animate={{ scale: [1, 1.15, 1], x: [0, 40, 0], y: [0, 30, 0], opacity: [0.85, 1, 0.85] }}
        transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
        className="absolute -top-[10%] -right-[5%] w-[50vw] h-[50vw] max-w-[600px] max-h-[600px] rounded-full mix-blend-screen"
        style={{
          background: 'radial-gradient(circle, rgba(139,92,246,0.5) 0%, rgba(139,92,246,0) 70%)',
          filter: 'blur(70px)',
        }}
      />
      {/* Bottom left indigo blob */}
      <motion.div
        animate={{ scale: [1, 1.2, 1], x: [0, -30, 0], y: [0, -50, 0], opacity: [0.75, 0.95, 0.75] }}
        transition={{ duration: 12, repeat: Infinity, ease: 'easeInOut', delay: 1 }}
        className="absolute -bottom-[10%] -left-[5%] w-[50vw] h-[50vw] max-w-[600px] max-h-[600px] rounded-full mix-blend-screen"
        style={{
          background: 'radial-gradient(circle, rgba(79,70,229,0.35) 0%, rgba(79,70,229,0) 70%)',
          filter: 'blur(90px)',
        }}
      />
      {/* Center ambient pink glow */}
      <motion.div
        animate={{ opacity: [0.3, 0.5, 0.3] }}
        transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[40vw] h-[40vw] max-w-[400px] max-h-[400px] rounded-full mix-blend-screen"
        style={{
          background: 'radial-gradient(circle, rgba(236,72,153,0.15) 0%, rgba(236,72,153,0) 60%)',
          filter: 'blur(100px)',
        }}
      />
      {/* Noise grain */}
      <div
        className="absolute inset-0 opacity-[0.04] mix-blend-overlay"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.75' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
        }}
      />
    </div>
  );
}

// ── Security feature pills ────────────────────────────────────────────────────
function SecurityPills() {
  const pills = [
    { icon: ShieldCheck,  label: 'AES-256-GCM' },
    { icon: Fingerprint,  label: 'Argon2id KDF' },
    { icon: Lock,         label: 'Zero-Knowledge' },
  ];
  return (
    <div className="flex items-center justify-center gap-2 flex-wrap mt-5">
      {pills.map(({ icon: Icon, label }) => (
        <motion.div
          key={label}
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.6 }}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-full
                     bg-white/[0.04] border border-white/[0.08] text-[10px] text-zinc-500"
        >
          <Icon className="h-3 w-3 text-violet-500" />
          <span>{label}</span>
        </motion.div>
      ))}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function LoginPage() {
  const router = useRouter();
  const { login, recover, error: authError, isDeriving, isLoading } = useAuth();

  const [email,       setEmail]       = useState('');
  const [password,    setPassword]    = useState('');
  const [mnemonic,    setMnemonic]    = useState('');
  const [showPass,    setShowPass]    = useState(false);
  const [localError,  setLocalError]  = useState<string | null>(null);
  const [mode,        setMode]        = useState<'login' | 'recover'>('login');
  const [loginMethod, setLoginMethod] = useState<'password' | 'passkey'>('password');

  const { isSupported, isAuthenticating, loginWithPasskey } = usePasskeys();

  const isPending = isDeriving || isLoading || isAuthenticating;

  useEffect(() => {
    // Only attempt conditional UI if the browser supports it and we are on the login mode
    if (mode === 'login' && isSupported) {
      const abortController = new AbortController();
      let isMounted = true;
      
      const startAutofill = async () => {
        // Delay slightly to ensure UI is ready
        await new Promise(resolve => setTimeout(resolve, 500));
        if (!isMounted) return;
        
        // Call loginWithPasskey with empty email, false for QR, true for ConditionalUI
        const user = await loginWithPasskey(undefined, false, true);
        if (user && isMounted) {
          router.push('/dashboard');
        }
      };
      
      startAutofill();
      
      return () => {
        isMounted = false;
        abortController.abort();
      };
    }
  }, [mode, isSupported, loginWithPasskey, router]);

  const handlePasskeyLogin = useCallback(async (useQR: boolean = false) => {
    setLocalError(null);
    if (!email.trim() && !useQR) {
      setLocalError('Please enter your email to login with Passkey.');
      return;
    }
    const user = await loginWithPasskey(email.trim() || undefined, useQR);
    if (user) {
      router.push('/dashboard');
    } else {
      setLocalError('Passkey login failed or was cancelled.');
    }
  }, [email, loginWithPasskey, router]);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);

    if (mode === 'login' && loginMethod === 'passkey') {
      await handlePasskeyLogin(false);
      return;
    }

    if (!email.trim() || (mode === 'login' ? !password : !mnemonic.trim())) {
      setLocalError(`Please enter your email and ${mode === 'login' ? 'master password' : 'recovery phrase'}.`);
      return;
    }

    try {
      if (mode === 'login') {
        await login(email.trim(), password);
      } else {
        await recover(email.trim(), mnemonic.trim());
      }
      router.push('/dashboard');
    } catch (err: any) {
      setLocalError(err.message ?? `${mode === 'login' ? 'Login' : 'Recovery'} failed. Check your credentials.`);
    }
  }, [email, password, mnemonic, mode, loginMethod, login, recover, router, handlePasskeyLogin]);

  const displayError = localError ?? authError;

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#050505] px-4 relative overflow-hidden">
      <BackgroundBlobs />

      <motion.div
        initial={{ opacity: 0, y: 28 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="relative z-10 w-full max-w-[420px]"
      >
        {/* Card */}
        <div className="rounded-[32px] border border-white/[0.12] bg-zinc-950/40 backdrop-blur-3xl
                        shadow-[0_0_80px_-20px_rgba(139,92,246,0.25)] overflow-hidden relative">
          
          {/* Inner subtle glow */}
          <div className="absolute inset-0 rounded-[32px] pointer-events-none border border-white/5 mix-blend-overlay" />

          {/* Top gradient stripe */}
          <div className="h-px w-full bg-gradient-to-r from-transparent via-violet-500/80 to-transparent absolute top-0 left-0" />

          <div className="p-8">
            {/* Header */}
            <div className="flex flex-col items-center text-center mb-7">
              <motion.div
                initial={{ scale: 0.7, opacity: 0 }}
                animate={{ scale: 1,   opacity: 1 }}
                transition={{ delay: 0.15, type: 'spring', stiffness: 300, damping: 20 }}
                className="relative mb-6"
              >
                <div className="absolute inset-0 rounded-2xl bg-violet-600/40 blur-xl scale-[1.6]" />
                <div className="relative h-16 w-16 rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shadow-[0_0_30px_rgba(139,92,246,0.4)] border border-white/20">
                  <ShieldCheck className="h-8 w-8 text-white drop-shadow-md" />
                </div>
              </motion.div>
              
              <h2 className="text-2xl font-bold text-white tracking-tight">ZKFS Vault</h2>
              <p className="text-[13px] text-zinc-400 mt-2 font-medium">
                {mode === 'login' ? 'Zero-knowledge end-to-end encryption.' : 'Recover your encrypted files.'}
              </p>
            </div>

            {/* Method Switcher Tabs */}
            {mode === 'login' && (
              <div className="flex p-1 mb-6 rounded-2xl bg-white/[0.04] border border-white/[0.08]">
                <button
                  type="button"
                  onClick={() => setLoginMethod('password')}
                  className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-bold transition-all duration-300 ${
                    loginMethod === 'password'
                      ? 'bg-violet-600 text-white shadow-neon-violet'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  <Lock className="h-3.5 w-3.5" />
                  <span>Password</span>
                </button>
                <button
                  type="button"
                  onClick={() => setLoginMethod('passkey')}
                  className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-bold transition-all duration-300 ${
                    loginMethod === 'passkey'
                      ? 'bg-violet-600 text-white shadow-neon-violet'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  <Fingerprint className="h-3.5 w-3.5" />
                  <span>Passkey / QR Code</span>
                </button>
              </div>
            )}

            {/* Form */}
            <form onSubmit={handleSubmit} noValidate className="space-y-4">
              {/* Email */}
              <div>
                <label
                  htmlFor="login-email"
                  className="block text-[11px] font-bold text-zinc-300 uppercase tracking-widest mb-2"
                >
                  Email Address
                </label>
                <input
                  id="login-email"
                  type="email"
                  autoComplete="username webauthn"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  disabled={isPending}
                  className="w-full px-4 py-3.5 rounded-2xl
                             bg-white/[0.03] border border-white/10
                             text-white text-[15px] placeholder-zinc-500
                             focus:outline-none focus:border-violet-500/80 focus:ring-4 focus:ring-violet-500/30 focus:bg-white/[0.06] focus:shadow-neon-violet
                             transition-all duration-300 disabled:opacity-50 hover:bg-white/[0.04] shadow-[inset_0_2px_4px_rgba(0,0,0,0.2)]"
                />
              </div>

              {/* Password / Mnemonic */}
              {mode === 'login' && loginMethod === 'password' ? (
                <div>
                  <div className="flex justify-between items-end mb-2">
                    <label
                      htmlFor="login-password"
                      className="block text-[11px] font-bold text-zinc-300 uppercase tracking-widest"
                    >
                      Master Password
                    </label>
                    <button
                      type="button"
                      onClick={() => setMode('recover')}
                      className="text-[11px] font-medium text-violet-400 hover:text-violet-300 transition-colors"
                    >
                      Forgot? Use Recovery Phrase
                    </button>
                  </div>
                  <div className="relative">
                    <input
                      id="login-password"
                      type={showPass ? 'text' : 'password'}
                      autoComplete="current-password"
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      placeholder="••••••••••••••"
                      disabled={isPending}
                      className="w-full px-4 py-3.5 pr-12 rounded-2xl
                                 bg-white/[0.03] border border-white/10
                                 text-white text-[15px] placeholder-zinc-500
                                 focus:outline-none focus:border-violet-500/80 focus:ring-4 focus:ring-violet-500/30 focus:bg-white/[0.06] focus:shadow-neon-violet
                                 transition-all duration-300 disabled:opacity-50 hover:bg-white/[0.04] shadow-[inset_0_2px_4px_rgba(0,0,0,0.2)]"
                    />
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={() => setShowPass(p => !p)}
                      className="absolute right-3.5 top-1/2 -translate-y-1/2
                                 text-zinc-500 hover:text-zinc-300 transition-colors p-0.5"
                      aria-label={showPass ? 'Hide password' : 'Show password'}
                    >
                      {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
              ) : mode === 'recover' ? (
                <div>
                  <div className="flex justify-between items-end mb-2">
                    <label
                      htmlFor="login-mnemonic"
                      className="block text-[11px] font-bold text-emerald-400 uppercase tracking-widest"
                    >
                      Recovery Phrase
                    </label>
                    <button
                      type="button"
                      onClick={() => setMode('login')}
                      className="text-[11px] font-medium text-zinc-400 hover:text-zinc-300 transition-colors"
                    >
                      Back to Login
                    </button>
                  </div>
                  <input
                    id="login-mnemonic"
                    type="text"
                    value={mnemonic}
                    onChange={e => setMnemonic(e.target.value)}
                    placeholder="Enter your 12-word phrase"
                    disabled={isPending}
                      className="w-full px-4 py-3.5 rounded-2xl
                                 bg-white/[0.03] border border-white/10
                                 text-white text-[15px] placeholder-zinc-500
                                 focus:outline-none focus:border-violet-500/80 focus:ring-4 focus:ring-violet-500/30 focus:bg-white/[0.06] focus:shadow-neon-violet
                                 transition-all duration-300 disabled:opacity-50 hover:bg-white/[0.04] shadow-[inset_0_2px_4px_rgba(0,0,0,0.2)]"
                  />
                </div>
              ) : null}

              {/* Error banner */}
              {displayError && (
                <motion.div
                  initial={{ opacity: 0, y: -6, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0,  scale: 1    }}
                  className="flex items-start gap-3 p-4 rounded-xl
                             bg-red-500/5 border border-red-500/10 text-red-400 text-xs"
                >
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span className="leading-relaxed">{displayError}</span>
                </motion.div>
              )}

              {mode === 'recover' || (mode === 'login' && loginMethod === 'password') ? (
                <button
                  type="submit"
                  disabled={isPending}
                  className={`w-full flex items-center justify-center gap-2.5 py-4 mt-6
                             ${mode === 'login' ? 'btn-neon' : 'btn-2d-glass !bg-emerald-600 !shadow-[0_4px_0_rgba(4,120,87,1),0_0_15px_rgba(16,185,129,0.5)]'}
                             disabled:opacity-50 disabled:cursor-not-allowed group`}
                >
                  <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-[150%] group-hover:translate-x-[150%] transition-transform duration-1000 ease-in-out" />

                  {isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>
                        {mode === 'login' ? 'Authenticating…' : 'Recovering…'}
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="drop-shadow-md">{mode === 'login' ? 'Sign In with Password' : 'Recover Account'}</span>
                      <ArrowRight className="h-4 w-4 drop-shadow-md" />
                    </>
                  )}
                </button>
              ) : (
                <div className="space-y-3 pt-2">
                  <button
                    type="button"
                    onClick={() => handlePasskeyLogin(false)}
                    disabled={isPending}
                    className="btn-2d-glass w-full flex items-center justify-center gap-3 py-3.5 text-xs font-bold disabled:opacity-50 group"
                  >
                    <Fingerprint className="h-4 w-4 text-violet-300" />
                    <span>{isAuthenticating ? 'Waiting for Device...' : 'Unlock with This Device (Touch ID / Hello)'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handlePasskeyLogin(true)}
                    disabled={isPending}
                    className="btn-neon w-full flex items-center justify-center gap-3 py-3.5 text-xs font-bold disabled:opacity-50 !bg-violet-600 hover:!bg-violet-500"
                  >
                    <QrCode className="h-4 w-4 text-white" />
                    <span>{isAuthenticating ? 'Waiting for Scan...' : 'Scan QR Code with Smartphone'}</span>
                  </button>
                </div>
              )}
            </form>

            {/* ZK badge row */}
            <div className="flex items-center justify-center gap-2 mt-6 text-[11px] text-zinc-600">
              <Shield className="h-3.5 w-3.5 text-emerald-600/80" />
              <span>Zero-Knowledge · Server never sees your password or keys</span>
            </div>
          </div>

          {/* Bottom gradient stripe */}
          <div className="h-px w-full bg-gradient-to-r from-transparent via-white/[0.06] to-transparent" />
        </div>

        {/* Security pills below card */}
        <SecurityPills />

        {/* Register link */}
        <p className="text-center text-[13px] text-zinc-600 mt-6">
          New here?{' '}
          <Link
            href="/register"
            className="text-violet-400 hover:text-violet-300 font-medium
                       transition-colors underline-offset-2 hover:underline"
          >
            Create a vault
          </Link>
        </p>
      </motion.div>
    </div>
  );
}
