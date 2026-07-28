/**
 * app/settings/page.tsx
 *
 * ZK Vault — Settings Page
 * Displays: account info, session security status, Argon2id parameters,
 * storage quota, and sign-out action.
 */

'use client';

import React from 'react';
import { motion }  from 'framer-motion';
import {
  Shield, Lock, LogOut, HardDrive, Key,
  ChevronRight, AlertTriangle, CheckCircle2,
  QrCode, Smartphone, Laptop
} from 'lucide-react';
import { useVaultStore } from '@/store/useVaultStore';
import { useAuth }       from '@/hooks/useAuth';
import { usePasskeys }   from '@/hooks/usePasskeys';
import { generateMnemonic, wrapKekWithMnemonic } from '@/lib/crypto/recovery';
import { authApi }       from '@/lib/api/auth';
import { base64ToBuffer } from '@/lib/crypto/index';

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatBytes(b: number): string {
  if (b < 1024)       return `${b} B`;
  if (b < 1024 ** 2)  return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 ** 3)  return `${(b / 1024 ** 2).toFixed(1)} MB`;
  return `${(b / 1024 ** 3).toFixed(2)} GB`;
}

// ── Section Wrapper ───────────────────────────────────────────────────────────

function SettingSection({
  title, description, children,
}: {
  title:       string;
  description: string;
  children:    React.ReactNode;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-white/[0.08] bg-zinc-900/60 overflow-hidden"
    >
      <div className="px-6 py-4 border-b border-white/[0.06]">
        <h2 className="text-sm font-semibold text-white">{title}</h2>
        <p className="text-xs text-zinc-500 mt-0.5">{description}</p>
      </div>
      <div>{children}</div>
    </motion.section>
  );
}

function SettingRow({
  label, value, sublabel, icon: Icon, dangerous, onClick,
}: {
  label:      string;
  value?:     string;
  sublabel?:  string;
  icon:       React.ElementType;
  dangerous?: boolean;
  onClick?:   () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={`flex items-center gap-4 px-6 py-4 border-b border-white/[0.04] last:border-0
                  transition-colors duration-150
                  ${onClick ? 'cursor-pointer' : ''}
                  ${dangerous
                    ? 'hover:bg-red-500/10 group'
                    : onClick ? 'hover:bg-white/[0.025]' : ''
                  }`}
    >
      <div className={`flex h-9 w-9 items-center justify-center rounded-xl shrink-0
                       ${dangerous ? 'bg-red-500/15 text-red-400' : 'bg-white/[0.06] text-zinc-400'}`}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium ${dangerous ? 'text-red-400 group-hover:text-red-300' : 'text-zinc-200'}`}>
          {label}
        </p>
        {sublabel && <p className="text-xs text-zinc-600 mt-0.5">{sublabel}</p>}
      </div>
      {value && (
        <span className="text-xs text-zinc-500 font-mono shrink-0">{value}</span>
      )}
      {onClick && (
        <ChevronRight className={`h-4 w-4 shrink-0 ${dangerous ? 'text-red-600' : 'text-zinc-700'}`} />
      )}
    </div>
  );
}

// ── Passkey Section ─────────────────────────────────────────────────────────────

function PasskeySection() {
  const { isSupported, isRegistering, error, registerPasskey } = usePasskeys();
  const [passkeys, setPasskeys] = React.useState<any[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);

  const fetchPasskeys = React.useCallback(async () => {
    try {
      const data = await authApi.getRegisteredPasskeys();
      setPasskeys(data);
    } catch (err) {
      console.error("Failed to fetch passkeys", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    fetchPasskeys();
  }, [fetchPasskeys]);

  if (!isSupported) {
    return (
      <SettingSection title="Passkeys (WebAuthn)" description="Hardware-backed authentication">
        <div className="px-6 py-4 text-sm text-zinc-400">
          Your browser does not support WebAuthn passkeys.
        </div>
      </SettingSection>
    );
  }

  const handleRegister = async (useQR: boolean) => {
    // Smart Device Naming
    const ua = navigator.userAgent;
    let browser = "Browser";
    if (ua.includes("Chrome")) browser = "Chrome";
    else if (ua.includes("Safari") && !ua.includes("Chrome")) browser = "Safari";
    else if (ua.includes("Firefox")) browser = "Firefox";
    else if (ua.includes("Edge")) browser = "Edge";
    
    let os = "Device";
    if (ua.includes("Win")) os = "Windows";
    else if (ua.includes("Mac")) os = "MacOS";
    else if (ua.includes("Android")) os = "Android";
    else if (ua.includes("like Mac")) os = "iOS";
    
    const smartName = `${browser} on ${os}`;
    const defaultName = useQR ? "My Smartphone (QR)" : smartName;
    const deviceName = prompt("Enter a label for this passkey:", defaultName);
    if (!deviceName) return;
    const success = await registerPasskey(deviceName, useQR);
    if (success) {
      await fetchPasskeys();
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to remove this passkey?")) return;
    try {
      await authApi.deletePasskey(id);
      setPasskeys(p => p.filter(x => x.id !== id));
    } catch (err) {
      console.error("Failed to delete passkey", err);
    }
  };

  return (
    <SettingSection title="Hardware Security (WebAuthn)" description="Zero-knowledge hardware & cross-device authentication">
      <div className="p-6 relative overflow-hidden group space-y-5">
        <div className="absolute inset-0 bg-gradient-to-br from-violet-500/5 to-transparent pointer-events-none" />
        
        <div>
          <h3 className="text-[15px] font-semibold text-white flex items-center gap-2">
            <Key className="h-4 w-4 text-violet-400" />
            Passkey & QR Code Authentication
          </h3>
          <p className="text-[13px] text-zinc-400 mt-1 max-w-xl leading-relaxed">
            Create a hardware-encrypted passkey to unlock your vault instantly without your master password. You can save it directly on this device or generate a QR Code to scan with your iPhone or Android camera!
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 pt-1">
          <button
            onClick={() => handleRegister(false)}
            disabled={isRegistering}
            className="btn-2d-glass relative flex items-center gap-2 px-5 py-2.5 text-xs font-semibold transition-all duration-300 disabled:opacity-50"
          >
            <Laptop className="h-4 w-4 text-violet-300" />
            <span>{isRegistering ? 'Registering...' : 'Add This Device (Touch ID / Hello)'}</span>
          </button>

          <button
            onClick={() => handleRegister(true)}
            disabled={isRegistering}
            className="btn-gloss relative flex items-center gap-2 px-5 py-2.5 text-xs font-semibold transition-all duration-300 disabled:opacity-50"
          >
            <QrCode className="h-4 w-4 text-white" />
            <span>{isRegistering ? 'Waiting for Scan...' : 'Generate with QR Code (Smartphone)'}</span>
          </button>
        </div>

        {/* Registered Devices List */}
        <div className="pt-6 mt-6 border-t border-white/10 relative z-10">
          <h4 className="text-sm font-medium text-white mb-3 flex items-center gap-2">
            <Smartphone className="h-4 w-4 text-violet-400" />
            Registered Devices
          </h4>
          
          {isLoading ? (
            <div className="text-xs text-zinc-500">Loading devices...</div>
          ) : passkeys.length === 0 ? (
            <div className="text-xs text-zinc-500">No passkeys registered yet.</div>
          ) : (
            <div className="space-y-2">
              {passkeys.map(pk => (
                <div key={pk.id} className="flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/5 hover:bg-white/10 transition-colors">
                  <div className="flex items-center gap-3 flex-1">
                    <div className="h-8 w-8 rounded-full bg-violet-500/20 flex items-center justify-center shrink-0">
                      <Key className="h-4 w-4 text-violet-400" />
                    </div>
                    <div>
                      <div className="text-sm text-zinc-200 font-medium flex items-center gap-2">
                        {pk.name}
                        {pk.isEncryptionReady ? (
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wide uppercase bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                            Encryption Ready
                          </span>
                        ) : (
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wide uppercase bg-amber-500/10 text-amber-400 border border-amber-500/20" title="This passkey does not support WebAuthn PRF. Vault unlocks will still require a password.">
                            Login Only
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-zinc-500 mt-0.5">Added on {new Date(pk.createdAt).toLocaleDateString()}</div>
                    </div>
                  </div>
                  <button
                    onClick={() => handleDelete(pk.id)}
                    className="text-xs text-red-400 hover:text-red-300 px-3 py-1.5 rounded-lg hover:bg-red-500/10 transition-colors shrink-0 ml-2"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      
      {error && (
        <div className="px-6 py-3 text-sm text-red-400 bg-red-500/10 border-t border-red-500/20 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}
    </SettingSection>
  );
}

// ── Recovery Section ─────────────────────────────────────────────────────────────

function RecoverySection() {
  const [isGenerating, setIsGenerating] = React.useState(false);
  const [mnemonic, setMnemonic] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState(false);
  const kek = useVaultStore((s) => s.kek);

  const handleGenerate = async () => {
    if (!kek) {
      setError('Vault is locked. Cannot generate a new recovery key.');
      return;
    }
    setIsGenerating(true);
    setError(null);
    setSuccess(false);
    
    try {
      const email = useVaultStore.getState().userEmail;
      if (!email) throw new Error('User email not found');

      // 1. Fetch salt for wrapping
      const { salt: saltB64 } = await authApi.getSalt(email);
      const saltBytes = new Uint8Array(base64ToBuffer(saltB64));

      // 2. Generate new mnemonic
      const newMnemonic = generateMnemonic();
      
      // 3. Export KEK
      const exportedKek = await crypto.subtle.exportKey('raw', kek);
      const kekBytes = new Uint8Array(exportedKek);
      
      // 4. Wrap KEK
      const { wrappedKek, iv } = await wrapKekWithMnemonic(kekBytes, newMnemonic, saltBytes);
      kekBytes.fill(0); // Zero out
      
      // 5. Send to server
      await authApi.updateRecoveryKey(wrappedKek, iv);
      
      setMnemonic(newMnemonic);
      setSuccess(true);
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Failed to generate recovery key');
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <SettingSection title="Secret Key (Recovery Phrase)" description="Generate a new 12-word recovery phrase">
      <div className="p-6">
        <h3 className="text-[15px] font-semibold text-white flex items-center gap-2 mb-1">
          <Key className="h-4 w-4 text-emerald-400" />
          Generate New Secret Key
        </h3>
        <p className="text-[13px] text-zinc-400 mb-4 max-w-lg leading-relaxed">
          If you forget your master password or lose your passkey, your Secret Key is the only way to recover your vault. Generating a new one will invalidate your old Secret Key.
        </p>

        {mnemonic ? (
          <div className="space-y-4">
            <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
              <p className="text-emerald-400 text-sm font-medium mb-2 flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4" />
                New Secret Key Generated
              </p>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {mnemonic.split(' ').map((word, i) => (
                  <div key={i} className="bg-black/40 border border-white/5 rounded px-3 py-2 flex items-center gap-2">
                    <span className="text-[10px] text-zinc-500 select-none">{(i + 1).toString().padStart(2, '0')}</span>
                    <span className="text-sm text-zinc-200 font-mono select-all">{word}</span>
                  </div>
                ))}
              </div>
              <p className="text-xs text-amber-400 mt-3 flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5" />
                Save these 12 words in a secure place. They will not be shown again.
              </p>
            </div>
            <button
              onClick={() => setMnemonic(null)}
              className="px-4 py-2 text-sm text-zinc-300 bg-white/5 hover:bg-white/10 rounded-lg transition-colors"
            >
              I have saved it securely
            </button>
          </div>
        ) : (
          <button
            onClick={handleGenerate}
            disabled={isGenerating || !kek}
            className="btn-2d-glass px-5 py-2.5 text-sm transition-all duration-300 disabled:opacity-50"
          >
            {isGenerating ? 'Generating...' : 'Generate Secret Key'}
          </button>
        )}
        
        {error && (
          <div className="mt-4 px-4 py-3 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}
      </div>
    </SettingSection>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const kek          = useVaultStore(s => s.kek);
  const userEmail    = useVaultStore(s => s.userEmail);
  const storageQuota = useVaultStore(s => s.storageQuota);
  const { logout }   = useAuth();

  const usedPct  = Math.min(100, (storageQuota.used / storageQuota.total) * 100);
  const usedStr  = formatBytes(storageQuota.used);
  const totalStr = formatBytes(storageQuota.total);

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
      {/* Page header */}
      <div className="mb-2">
        <h1 className="text-xl font-bold text-white">Settings</h1>
        <p className="text-sm text-zinc-500 mt-1">
          Security configuration and account preferences
        </p>
      </div>

      {/* ── Security Status ─────────────────────────────────────────────────── */}
      <SettingSection
        title="Session Security"
        description="Current cryptographic session state"
      >
        <SettingRow
          icon={Key}
          label="Session KEK (AES-256)"
          sublabel="Key Encryption Key — stored in RAM only, wiped on logout"
          value={kek ? 'Active' : 'Not loaded'}
        />
        {kek ? (
          <div className="flex items-center gap-2 px-6 py-3 bg-emerald-500/10 border-t border-emerald-500/20">
            <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
            <p className="text-xs text-emerald-400">
              E2EE active — all file operations use your in-memory KEK.
              The server never sees your decryption key.
            </p>
          </div>
        ) : (
          <div className="flex items-center gap-2 px-6 py-3 bg-amber-500/10 border-t border-amber-500/20">
            <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
            <p className="text-xs text-amber-400">
              Session key not loaded. You can browse metadata but cannot decrypt files.
              Re-authenticate to restore your session key.
            </p>
          </div>
        )}
      </SettingSection>

      {/* ── Crypto Parameters ───────────────────────────────────────────────── */}
      <SettingSection
        title="Cryptographic Parameters"
        description="Argon2id and AES-GCM configuration (read-only)"
      >
        <SettingRow
          icon={Shield}
          label="Key Derivation Function"
          value="Argon2id"
          sublabel="WASM implementation — runs in-browser, off-thread"
        />
        <SettingRow
          icon={Shield}
          label="Memory Cost"
          value="64 MiB"
          sublabel="Argon2id memory parameter"
        />
        <SettingRow
          icon={Shield}
          label="Time Cost (Iterations)"
          value="3 passes"
          sublabel="Argon2id iteration count"
        />
        <SettingRow
          icon={Shield}
          label="Parallelism"
          value="1 thread"
          sublabel="Argon2id parallelism factor"
        />
        <SettingRow
          icon={Lock}
          label="File Encryption"
          value="AES-256-GCM"
          sublabel="Per-chunk 12-byte random IV · 128-bit authentication tag"
        />
        <SettingRow
          icon={Lock}
          label="DEK Wrapping"
          value="AES-256-GCM"
          sublabel="Data Encryption Key wrapped with your KEK, stored server-side"
        />
      </SettingSection>

      {/* ── Passkeys ────────────────────────────────────────────────────────── */}
      <PasskeySection />

      {/* ── Secret Key ──────────────────────────────────────────────────────── */}
      <RecoverySection />

      {/* ── Storage ─────────────────────────────────────────────────────────── */}
      <SettingSection
        title="Storage Quota"
        description="Encrypted storage usage"
      >
        <div className="px-6 py-5 space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-zinc-400">Used</span>
            <span className="text-white font-medium tabular-nums">
              {usedStr} / {totalStr}
            </span>
          </div>
          <div className="h-2 w-full bg-white/10 rounded-full overflow-hidden">
            <motion.div
              className="h-full rounded-full"
              initial={{ width: 0 }}
              animate={{ width: `${usedPct}%` }}
              transition={{ duration: 1.0, ease: 'easeOut' }}
              style={{
                background: usedPct > 80 ? '#ef4444' : usedPct > 60 ? '#f59e0b' : '#8b5cf6',
              }}
            />
          </div>
          <p className="text-xs text-zinc-600">
            {usedPct.toFixed(1)}% of quota used
          </p>
        </div>
      </SettingSection>

      {/* ── Account ─────────────────────────────────────────────────────────── */}
      <SettingSection
        title="Account"
        description="Profile and session management"
      >
        <SettingRow
          icon={Shield}
          label="Email Address"
          value={userEmail ?? '—'}
          sublabel="Linked to your encrypted vault"
        />
        <SettingRow
          icon={HardDrive}
          label="Vault Storage"
          sublabel="Files are stored encrypted on the server — only you can decrypt them"
        />
        <SettingRow
          icon={LogOut}
          label="Sign Out"
          sublabel="Wipes session KEK from memory · Clears all auth tokens"
          dangerous
          onClick={logout}
        />
      </SettingSection>

      {/* ── About ────────────────────────────────────────────────────────────── */}
      <div className="text-center text-xs text-zinc-700 pt-2">
        ZK Vault · Zero-Knowledge E2EE File Storage · v0.1.0
        <br />
        Built with Argon2id · AES-256-GCM · WebCrypto API
      </div>
    </div>
  );
}
