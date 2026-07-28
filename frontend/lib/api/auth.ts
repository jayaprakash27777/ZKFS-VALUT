/**
 * lib/api/auth.ts
 *
 * Authentication API methods — aligned with the Spring Boot backend.
 *
 * ZK Auth Contract:
 *   - Register: sends { email, authHash (hex64), salt (base64 24-char) }
 *   - Login:    sends { email, authHash (hex64) }
 *   - Refresh:  sends { refreshToken }
 *   - Salt:     GET ?email=...
 */

import apiClient, { tokenStorage } from './client';

// ── Types ──────────────────────────────────────────────────────────────────

export interface RegisterRequest {
  email:    string;
  authHash: string; // 64-char hex — HKDF(Argon2id(password, salt), "zkfs-auth-v1")
  salt:     string; // Base64 24-char (16 bytes) — Argon2id salt generated in-browser
  recoveryWrappedKek?: string;
  recoveryIv?: string;
}

export interface LoginRequest {
  email:    string;
  authHash: string; // 64-char hex — NOT the plaintext password, NOT the KEK
}

export interface AuthResponse {
  accessToken:  string;
  refreshToken: string;
  tokenType:    string;
  expiresIn:    number;
  user: {
    id:        string;
    email:     string;
    salt:      string;   // Base64 Argon2 salt — returned so client can skip a round-trip on next login
    createdAt: string;
  };
}

export interface SaltResponse {
  salt: string; // Base64-encoded Argon2id salt
  recoveryWrappedKek?: string;
  recoveryIv?: string;
}

// ── API Methods ────────────────────────────────────────────────────────────

export const authApi = {

  /**
   * Fetch the user's Argon2id salt before login.
   * Used by the browser to derive KEK before sending authHash.
   * Anti-enumeration: unknown emails get a fake deterministic salt.
   */
  async getSalt(email: string): Promise<SaltResponse> {
    const { data } = await apiClient.get<SaltResponse>('v1/auth/salt', {
      params: { email },
    });
    return data;
  },

  /**
   * Register a new user.
   * Sends authHash (HKDF-derived from KEK) — NOT the raw password or KEK.
   * Server stores bcrypt(authHash).
   */
  async register(request: RegisterRequest): Promise<AuthResponse> {
    const { data } = await apiClient.post<AuthResponse>('v1/auth/register', request);
    tokenStorage.setTokens(data.accessToken, data.refreshToken);
    return data;
  },

  /**
   * Login with authHash.
   * Sends authHash (derived from Argon2id KEK via HKDF) — NOT the plaintext password.
   * Server runs bcrypt.matches(authHash, storedBcryptHash).
   */
  async login(request: LoginRequest): Promise<AuthResponse> {
    const { data } = await apiClient.post<AuthResponse>('v1/auth/login', request);
    tokenStorage.setTokens(data.accessToken, data.refreshToken);
    return data;
  },

  /**
   * Update the user's RSA keypair.
   */
  async updateKeys(publicKey: string, encPrivateKey: string): Promise<void> {
    await apiClient.put('v1/auth/keys', {
      publicKey,
      encPrivateKey
    });
  },

  /**
   * Refresh the access token using the stored refresh token.
   */
  async refresh(): Promise<AuthResponse> {
    const refreshToken = tokenStorage.getRefreshToken();
    const { data } = await apiClient.post<AuthResponse>('v1/auth/refresh', { refreshToken });
    tokenStorage.setTokens(data.accessToken, data.refreshToken);
    return data;
  },

  /** Clear tokens and redirect to login. */
  logout(): void {
    tokenStorage.clearTokens();
    if (typeof window !== 'undefined') {
      window.location.href = '/login';
    }
  },

  // ── Passkey / WebAuthn ──────────────────────────────────────────────────

  async getPasskeyRegisterOptions() {
    const { data } = await apiClient.get<any>('v1/auth/passkey/register/options');
    return data;
  },

  async registerPasskey(responseJson: string, passkeyWrappedKek: string, deviceName: string) {
    const { data } = await apiClient.post('v1/auth/passkey/register', {
      responseJson,
      passkeyWrappedKek,
      deviceName,
    });
    return data;
  },

  async getPasskeyLoginOptions(email?: string) {
    const params = email ? { email } : {};
    const { data } = await apiClient.get<any>('v1/auth/passkey/login/options', { params });
    return data; // { requestId, options }
  },

  async loginPasskey(requestId: string, responseJson: string): Promise<any> {
    const { data } = await apiClient.post<any>('v1/auth/passkey/login', {
      requestId,
      responseJson,
    });
    // Set token immediately after login
    tokenStorage.setTokens(data.token, data.refreshToken || '');
    return data;
  },

  async updateRecoveryKey(recoveryWrappedKek: string, recoveryIv: string): Promise<void> {
    await apiClient.put('v1/auth/recovery-key', {
      recoveryWrappedKek,
      recoveryIv,
    });
  },

  async getRegisteredPasskeys(): Promise<{id: string, name: string, createdAt: string, isEncryptionReady: boolean}[]> {
    const { data } = await apiClient.get('v1/auth/passkey/list');
    return data;
  },

  async deletePasskey(id: string): Promise<void> {
    await apiClient.delete(`v1/auth/passkey/${id}`);
  }
};
