/**
 * hooks/useAuth.ts  (Phase 2 — Argon2id + Vault Store Bridge)
 *
 * Authentication hook — manages auth state with zero-knowledge guarantees.
 * On login/register success, syncs KEK and user info into the global Vault
 * Zustand store so all dashboard components can access them.
 *
 * Key properties:
 *   • KEK is derived via Argon2id (WASM) — never leaves the browser
 *   • authHash is derived via HKDF — NOT the KEK — sent to the server
 *   • Vault store kek is wiped on logout
 */

'use client';

import { useCallback, useEffect, useReducer } from 'react';
import {
  deriveRegistrationKeyMaterial,
  deriveLoginKeyMaterial,
} from '@/lib/crypto/argon2';
import { wrapKekWithMnemonic, unwrapKekWithMnemonic } from '@/lib/crypto/recovery';
import { base64ToBuffer } from '@/lib/crypto/index';
import { generateRSAKeyPair, exportPublicKey, exportPrivateKey, wrapPrivateKeyWithKek, unwrapPrivateKeyWithKek } from '@/lib/crypto/asymmetric';
import { authApi }           from '@/lib/api/auth';
import { tokenStorage }      from '@/lib/api/client';
import { useVaultStore }     from '@/store/useVaultStore';

// ── Types ──────────────────────────────────────────────────────────────────

export interface AuthUser {
  id:            string;
  email:         string;
  salt:          string;
  encPrivateKey?: string;
  publicKey?:    string;
  createdAt:     string;
}

interface AuthState {
  user:       AuthUser | null;
  isLoading:  boolean;
  isLoggedIn: boolean;
  isDeriving: boolean;
  error:      string | null;
}

type AuthAction =
  | { type: 'INIT_COMPLETE'; hasToken: boolean }
  | { type: 'DERIVE_START' }
  | { type: 'LOGIN_SUCCESS'; user: AuthUser }
  | { type: 'LOGOUT' }
  | { type: 'ERROR'; message: string }
  | { type: 'CLEAR_ERROR' };

// ── Reducer ────────────────────────────────────────────────────────────────

const initialState: AuthState = {
  user:       null,
  isLoading:  true,
  isLoggedIn: false,
  isDeriving: false,
  error:      null,
};

function authReducer(state: AuthState, action: AuthAction): AuthState {
  switch (action.type) {
    case 'INIT_COMPLETE':
      return { ...state, isLoading: false, isLoggedIn: action.hasToken };
    case 'DERIVE_START':
      return { ...state, isDeriving: true, error: null };
    case 'LOGIN_SUCCESS':
      return {
        ...state,
        user:       action.user,
        isLoading:  false,
        isLoggedIn: true,
        isDeriving: false,
        error:      null,
      };
    case 'LOGOUT':
      return { ...initialState, isLoading: false };
    case 'ERROR':
      return { ...state, isLoading: false, isDeriving: false, error: action.message };
    case 'CLEAR_ERROR':
      return { ...state, error: null };
    default:
      return state;
  }
}

// ── Hook ───────────────────────────────────────────────────────────────────

export function useAuth() {
  const [state, dispatch] = useReducer(authReducer, initialState);

  // Vault store actions — used to bridge KEK into global state
  const setKek    = useVaultStore(s => s.setKek);
  const setUser   = useVaultStore(s => s.setUser);
  const vaultLogout = useVaultStore(s => s.logout);

  // ── Session Detection ─────────────────────────────────────────────────────
  useEffect(() => {
    const hasToken = !!tokenStorage.getAccessToken();
    dispatch({ type: 'INIT_COMPLETE', hasToken });
    // NOTE: KEK is NOT restored from any persistent storage on page load.
    // The user must re-authenticate to re-derive the KEK after a page refresh.
  }, []);

  // ── Register ─────────────────────────────────────────────────────────────
  const setPrivateKey = useVaultStore(state => state.setPrivateKey);

  const checkAndUploadRSAKeys = useCallback(async (user: AuthUser, kek: CryptoKey) => {
    if (user.encPrivateKey && user.publicKey) {
      const pk = await unwrapPrivateKeyWithKek(user.encPrivateKey, kek);
      setPrivateKey(pk);
      return;
    }

    const keypair = await generateRSAKeyPair();
    const pubB64 = await exportPublicKey(keypair.publicKey);
    const privB64 = await exportPrivateKey(keypair.privateKey);

    const encPriv = await wrapPrivateKeyWithKek(privB64, kek);
    
    await authApi.updateKeys(pubB64, encPriv);
    setPrivateKey(keypair.privateKey);
  }, [setPrivateKey]);

  // ── Register ──────────────────────────────────────────────────────────────
  const register = useCallback(async (email: string, password: string, mnemonic: string): Promise<void> => {
    dispatch({ type: 'DERIVE_START' });
    try {
      // Step 1: Derive KEK via Argon2id + generate registration key material
      const { kek, saltB64, authHashHex, kekBytes } = await deriveRegistrationKeyMaterial(password);
      
      // Step 1.5: Wrap KEK with mnemonic for recovery
      const saltBytes = new Uint8Array(base64ToBuffer(saltB64));
      const { wrappedKek, iv } = await wrapKekWithMnemonic(kekBytes, mnemonic, saltBytes);
      kekBytes.fill(0); // Zero out after wrapping

      // Step 2: Authenticate with server — sends authHash only
      const response = await authApi.register({
        email,
        authHash: authHashHex,
        salt:     saltB64,
        recoveryWrappedKek: wrappedKek,
        recoveryIv: iv
      });

      // Step 3: Bridge KEK + user into Vault store for dashboard access
      setKek(kek);
      setUser(response.user.id, response.user.email);
      await checkAndUploadRSAKeys(response.user, kek);

      dispatch({ type: 'LOGIN_SUCCESS', user: response.user });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Registration failed';
      dispatch({ type: 'ERROR', message });
      throw err;
    }
  }, [setKek, setUser, checkAndUploadRSAKeys]);

  // ── Login ─────────────────────────────────────────────────────────────────
  const login = useCallback(async (email: string, password: string): Promise<void> => {
    dispatch({ type: 'DERIVE_START' });
    try {
      // Step 1: Fetch salt from server (needed for Argon2id to re-derive KEK)
      const { salt: saltB64 } = await authApi.getSalt(email);

      // Step 2: Derive KEK + authHash using Argon2id + HKDF (~300ms on first run)
      const { kek, authHashHex } = await deriveLoginKeyMaterial(password, saltB64);

      // Step 3: Authenticate with server — sends authHash only
      const response = await authApi.login({
        email,
        authHash: authHashHex,
      });

      // Step 4: Bridge KEK + user into Vault store for dashboard access
      setKek(kek);
      setUser(response.user.id, response.user.email);
      await checkAndUploadRSAKeys(response.user, kek);

      dispatch({ type: 'LOGIN_SUCCESS', user: response.user });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Invalid email or password';
      dispatch({ type: 'ERROR', message });
      throw err;
    }
  }, [setKek, setUser, checkAndUploadRSAKeys]);

  // ── Recovery ──────────────────────────────────────────────────────────────
  
  // ── Unlock Vault (Fallback for Passkeys without PRF) ──────────────────────
  const unlockVault = useCallback(async (email: string, password: string): Promise<boolean> => {
    dispatch({ type: 'DERIVE_START' });
    try {
      const { salt: saltB64 } = await authApi.getSalt(email);
      const { kek } = await deriveLoginKeyMaterial(password, saltB64);
      setKek(kek);
      dispatch({ type: 'CLEAR_ERROR' });
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Invalid password';
      dispatch({ type: 'ERROR', message });
      return false;
    }
  }, [setKek]);

  const recover = useCallback(async (email: string, mnemonic: string): Promise<void> => {
    dispatch({ type: 'DERIVE_START' });
    try {
      const { salt: saltB64, recoveryWrappedKek, recoveryIv } = await authApi.getSalt(email);
      
      if (!recoveryWrappedKek || !recoveryIv) {
        throw new Error('This account was created without a recovery phrase.');
      }

      const { kek, authHashHex } = await unwrapKekWithMnemonic(mnemonic, saltB64, recoveryWrappedKek, recoveryIv);

      const response = await authApi.login({
        email,
        authHash: authHashHex,
      });

      setKek(kek);
      setUser(response.user.id, response.user.email);

      dispatch({ type: 'LOGIN_SUCCESS', user: response.user });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Recovery failed. Check your phrase.';
      dispatch({ type: 'ERROR', message });
      throw err;
    }
  }, [setKek, setUser]);

  // ── Logout ────────────────────────────────────────────────────────────────
  const logout = useCallback(() => {
    // Clear all state including KEK from JS memory
    dispatch({ type: 'LOGOUT' });
    // Wipe vault store (KEK, uploads, selection)
    vaultLogout();
    // Clear auth tokens from localStorage + cookie
    tokenStorage.clearTokens();
    // Redirect to login
    if (typeof window !== 'undefined') {
      window.location.href = '/login';
    }
  }, [vaultLogout]);

  const clearError = useCallback(() => dispatch({ type: 'CLEAR_ERROR' }), []);

  return {
    user:       state.user,
    isLoading:  state.isLoading,
    isLoggedIn: state.isLoggedIn,
    isDeriving: state.isDeriving,
    error:      state.error,
    register,
    login,
    recover,
    logout,
    unlockVault,
    clearError,
  };
}
