/**
 * app/register/page.tsx
 *
 * Zero-Knowledge Registration — Premium UI
 * Generates a random Argon2id salt client-side, derives KEK locally,
 * sends only authHash + salt to server. KEK never leaves the browser.
 */

'use client';

import React, { useState, useCallback } from 'react';
import { useRouter }      from 'next/navigation';
import Link               from 'next/link';
import { motion }         from 'framer-motion';
import {
  Lock, Shield, ArrowRight, Loader2, AlertCircle,
  Eye, EyeOff, Check, ShieldCheck, Fingerprint, KeyRound,
} from 'lucide-react';
import { useAuth }        from '@/hooks/useAuth';
import { generateMnemonic } from '@/lib/crypto/recovery';

// ── Password strength meter ───────────────────────────────────────────────────
function PasswordStrength({ password }: { password: string }) {
  const checks = [
    { label: '8+ characters', ok: password.length >= 8 },
    { label: 'Uppercase',     ok: /[A-Z]/.test(password) },
    { label: 'Number',        ok: /\d/.test(password) },
    { label: 'Symbol',        ok: /[^A-Za-z0-9]/.test(password) },
  ];
  const passed = checks.filter(c => c.ok).length;
  const pct    = (passed / checks.length) * 100;
  const color  = pct <= 25 ? '#ef4444' : pct <= 50 ? '#f59e0b' : pct <= 75 ? '#a78bfa' : '#10b981';
  const label  = pct <= 25 ? 'Weak' : pct <= 50 ? 'Fair' : pct <= 75 ? 'Good' : 'Strong';

  return (
    <div className="mt-2.5 space-y-2">
      {/* Bar */}
      <div className="flex items-center gap-2">
        <div className="flex-1 h-1 bg-white/10 rounded-full overflow-hidden">
          <motion.div
            className="h-full rounded-full"
            style={{ backgroundColor: color }}
            initial={{ width: 0 }}
            animate={{ width: `${pct}%` }}
            transition={{ duration: 0.4 }}
          />
        </div>
        <span className="text-[10px] font-medium" style={{ color }}>{label}</span>
      </div>
      {/* Checks */}
      <div className="flex gap-2.5 flex-wrap">
        {checks.map(({ label, ok }) => (
          <motion.span
            key={label}
            animate={{ color: ok ? '#34d399' : '#52525b' }}
            className="flex items-center gap-1 text-[10px]"
          >
            <Check className={`h-2.5 w-2.5 transition-opacity ${ok ? 'opacity-100' : 'opacity-0'}`} />
            {label}
          </motion.span>
        ))}
      </div>
    </div>
  );
}

// ── Animated background ───────────────────────────────────────────────────────
function BackgroundBlobs() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none bg-[#030303]" aria-hidden>
      {/* Top right violet blob */}
      <motion.div
        animate={{ scale: [1, 1.1, 1], x: [0, 30, 0], y: [0, 20, 0], opacity: [0.8, 1, 0.8] }}
        transition={{ duration: 15, repeat: Infinity, ease: 'easeInOut' }}
        className="absolute -top-[10%] -right-[5%] w-[50vw] h-[50vw] max-w-[600px] max-h-[600px] rounded-full mix-blend-screen"
        style={{
          background: 'radial-gradient(circle, rgba(139,92,246,0.4) 0%, rgba(139,92,246,0) 70%)',
          filter: 'blur(80px)',
        }}
      />
      {/* Bottom left indigo blob */}
      <motion.div
        animate={{ scale: [1, 1.15, 1], x: [0, -20, 0], y: [0, -40, 0], opacity: [0.7, 0.9, 0.7] }}
        transition={{ duration: 18, repeat: Infinity, ease: 'easeInOut', delay: 2 }}
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
    { icon: KeyRound,     label: 'Local KEK derivation' },
    { icon: ShieldCheck,  label: 'AES-256-GCM' },
    { icon: Fingerprint,  label: 'Argon2id KDF' },
  ];
  return (
    <div className="flex items-center justify-center gap-2 flex-wrap mt-5">
      {pills.map(({ icon: Icon, label }) => (
        <motion.div
          key={label}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.7 }}
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
export default function RegisterPage() {
  const router   = useRouter();
  const { register, error: authError, isDeriving, isLoading } = useAuth();

  const [email,           setEmail]           = useState('');
  const [password,        setPassword]        = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPass,        setShowPass]        = useState(false);
  const [localError,      setLocalError]      = useState<string | null>(null);
  const [step,            setStep]            = useState<'form' | 'recovery'>('form');
  const [mnemonic,        setMnemonic]        = useState<string | null>(null);

  const isPending = isDeriving || isLoading;

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);

    if (!email.trim() || !password || !confirmPassword) {
      setLocalError('Please fill in all fields.');
      return;
    }
    if (password !== confirmPassword) {
      setLocalError('Passwords do not match.');
      return;
    }
    if (password.length < 8) {
      setLocalError('Master password must be at least 8 characters.');
      return;
    }

    if (step === 'form') {
      const generated = generateMnemonic();
      setMnemonic(generated);
      setStep('recovery');
      return;
    }

    try {
      if (!mnemonic) return;
      await register(email.trim(), password, mnemonic);
      router.push('/dashboard');
    } catch (err: any) {
      setLocalError(err.message ?? 'Registration failed. Try again.');
      setStep('form');
    }
  }, [email, password, confirmPassword, step, mnemonic, register, router]);

  const displayError      = localError ?? authError;
  const passwordMismatch  = confirmPassword && confirmPassword !== password;

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#050505] px-4 py-8 relative overflow-hidden">
      <BackgroundBlobs />

      <motion.div
        initial={{ opacity: 0, y: 28 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="relative z-10 w-full max-w-[440px]"
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
                <div className="relative flex h-16 w-16 items-center justify-center
                                rounded-[1.2rem] bg-gradient-to-br from-violet-500 to-indigo-600
                                shadow-[0_0_30px_rgba(139,92,246,0.5)] border border-white/20">
                  <Lock className="h-7 w-7 text-white drop-shadow-md" />
                </div>
              </motion.div>

              <h1 className="text-[1.7rem] font-bold text-white tracking-tight mb-2 drop-shadow-sm">
                Create Your Vault
              </h1>
              <p className="text-[13.5px] text-zinc-400 max-w-[300px] leading-relaxed">
                A cryptographic salt is generated locally.<br />
                Your KEK never leaves this device.
              </p>
            </div>

            {step === 'form' ? (
              <form onSubmit={handleSubmit} noValidate className="space-y-4">
                {/* Email */}
                <div>
                  <label
                    htmlFor="reg-email"
                    className="block text-[11px] font-bold text-zinc-300 uppercase tracking-widest mb-2"
                  >
                    Email Address
                  </label>
                  <input
                    id="reg-email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    disabled={isPending}
                    className="w-full px-4 py-3.5 rounded-xl
                               bg-white/[0.03] border border-white/10
                               text-white text-[15px] placeholder-zinc-500
                               focus:outline-none focus:border-violet-500/60 focus:ring-4 focus:ring-violet-500/20 focus:bg-white/[0.05]
                               transition-all duration-300 disabled:opacity-50 hover:bg-white/[0.04] shadow-[inset_0_2px_4px_rgba(0,0,0,0.2)]"
                  />
                </div>

                {/* Password */}
                <div>
                  <label
                    htmlFor="reg-password"
                    className="block text-[11px] font-bold text-zinc-300 uppercase tracking-widest mb-2"
                  >
                    Master Password
                  </label>
                  <div className="relative">
                    <input
                      id="reg-password"
                      type={showPass ? 'text' : 'password'}
                      autoComplete="new-password"
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      placeholder="Strong passphrase recommended"
                      disabled={isPending}
                      className="w-full px-4 py-3.5 pr-12 rounded-xl
                                 bg-white/[0.03] border border-white/10
                                 text-white text-[15px] placeholder-zinc-500
                                 focus:outline-none focus:border-violet-500/60 focus:ring-4 focus:ring-violet-500/20 focus:bg-white/[0.05]
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
                  {password && <PasswordStrength password={password} />}
                </div>

                {/* Confirm Password */}
                <div>
                  <label
                    htmlFor="reg-confirm"
                    className="block text-[11px] font-bold text-zinc-300 uppercase tracking-widest mb-2"
                  >
                    Confirm Password
                  </label>
                  <input
                    id="reg-confirm"
                    type={showPass ? 'text' : 'password'}
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value)}
                    placeholder="Repeat your password"
                    disabled={isPending}
                    className={`w-full px-4 py-3.5 rounded-xl
                               bg-white/[0.03] text-white text-[15px] placeholder-zinc-500 hover:bg-white/[0.04] shadow-[inset_0_2px_4px_rgba(0,0,0,0.2)]
                               focus:outline-none focus:ring-4 transition-all duration-300 disabled:opacity-50
                               ${passwordMismatch
                                 ? 'border border-red-500/60 focus:ring-red-500/20 focus:border-red-500/70 focus:bg-red-500/5'
                                 : 'border border-white/10 focus:border-violet-500/60 focus:ring-violet-500/20 focus:bg-white/[0.05]'
                               }`}
                  />
                  {passwordMismatch && (
                    <p className="text-[11px] text-red-400 mt-1.5 ml-1">Passwords don't match</p>
                  )}
                </div>

                {/* Error banner */}
                {displayError && (
                  <motion.div
                    initial={{ opacity: 0, y: -6, scale: 0.97 }}
                    animate={{ opacity: 1, y: 0,  scale: 1    }}
                    className="flex items-start gap-3 p-4 rounded-xl
                               bg-red-500/10 border border-red-500/25 text-red-400 text-xs"
                  >
                    <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                    <span className="leading-relaxed">{displayError}</span>
                  </motion.div>
                )}

                {/* Submit */}
                <button
                  type="submit"
                  disabled={isPending || !!passwordMismatch}
                  className="btn-neon w-full mt-6"
                >
                  <span className="drop-shadow-md">Continue</span>
                  <ArrowRight className="h-4 w-4 drop-shadow-md" />
                </button>
              </form>
            ) : (
              <form onSubmit={handleSubmit} noValidate className="space-y-4">
                <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 text-amber-200 text-sm leading-relaxed mb-4">
                  <p className="font-semibold mb-2 flex items-center gap-2"><AlertCircle className="w-4 h-4"/> Emergency Recovery Phrase</p>
                  <p>This is the <strong>ONLY</strong> way to recover your account if you forget your password. We cannot reset your password for you.</p>
                  <p className="mt-2 text-white bg-black/40 border border-white/10 rounded-lg p-3 font-mono text-center select-all cursor-text text-base">
                    {mnemonic}
                  </p>
                </div>

                {displayError && (
                  <motion.div
                    initial={{ opacity: 0, y: -6, scale: 0.97 }}
                    animate={{ opacity: 1, y: 0,  scale: 1    }}
                    className="flex items-start gap-3 p-4 rounded-xl
                               bg-red-500/10 border border-red-500/25 text-red-400 text-xs"
                  >
                    <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                    <span className="leading-relaxed">{displayError}</span>
                  </motion.div>
                )}

                <motion.button
                  type="submit"
                  disabled={isPending}
                  whileHover={{ scale: isPending ? 1 : 1.02 }}
                  whileTap={{ scale: isPending ? 1 : 0.98 }}
                  className="w-full flex items-center justify-center gap-2.5
                             py-3.5 mt-2 rounded-xl
                             bg-gradient-to-r from-emerald-600 to-emerald-700
                             hover:from-emerald-500 hover:to-emerald-600
                             disabled:opacity-50 disabled:cursor-not-allowed
                             text-white text-sm font-semibold tracking-wide
                             shadow-lg shadow-emerald-900/50
                             transition-all duration-200"
                >
                  {isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>
                        {isDeriving ? 'Generating KEK (Argon2id)…' : 'Creating vault…'}
                      </span>
                    </>
                  ) : (
                    <>
                      <span>I have saved it safely. Complete Registration</span>
                      <Check className="h-4 w-4" />
                    </>
                  )}
                </motion.button>
                <button
                  type="button"
                  onClick={() => setStep('form')}
                  className="w-full text-zinc-400 hover:text-white text-sm mt-2 transition-colors"
                >
                  Go Back
                </button>
              </form>
            )}

            {/* ZK note */}
            <div className="flex items-center justify-center gap-2 mt-6 text-[11px] text-zinc-600">
              <Shield className="h-3.5 w-3.5 text-emerald-600/80" />
              <span>Salt generated in-browser · Server never sees your KEK</span>
            </div>
          </div>

          {/* Bottom gradient stripe */}
          <div className="h-px w-full bg-gradient-to-r from-transparent via-white/[0.06] to-transparent" />
        </div>

        {/* Security pills */}
        <SecurityPills />

        {/* Login link */}
        <p className="text-center text-[13px] text-zinc-600 mt-6">
          Already have a vault?{' '}
          <Link
            href="/login"
            className="text-violet-400 hover:text-violet-300 font-medium
                       transition-colors underline-offset-2 hover:underline"
          >
            Sign in
          </Link>
        </p>
      </motion.div>
    </div>
  );
}
