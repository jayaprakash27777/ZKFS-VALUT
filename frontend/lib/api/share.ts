/**
 * lib/api/share.ts
 *
 * Zero-Knowledge Secure Share API Client
 * =======================================
 * Wraps all /v1/share endpoints.
 *
 * Public endpoints (GET) use a plain fetch without auth headers
 * so they work from the public /share/[token] page with no session.
 *
 * Protected endpoints (POST, DELETE) use the authenticated apiClient.
 */

import apiClient from './client';
import axios from 'axios';

const PUBLIC_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080/api';

// ── Types ───────────────────────────────────────────────────────────────────

/** Request body for POST /v1/share (all sensitive fields are server-opaque). */
export interface CreateShareRequest {
  fileId?:         string;   // UUID (optional if folderId is provided)
  folderId?:       string;   // UUID (optional if fileId is provided)
  shareSaltB64:    string;   // Base64 Argon2id salt
  shareWrappedDek: string;   // Base64(AES-GCM(DEK, shareKEK))
  shareIvDek:      string;   // Base64 12-byte IV for DEK wrap
  shareEncFilename:string;   // Base64(AES-GCM(filename, shareKEK))
  shareIvFilename: string;   // Base64 12-byte IV for filename
  expiresHours?:   number;   // 0 = never, max 720
  maxDownloads?:   number;   // 0 = unlimited
}

/** Response from POST /v1/share */
export interface CreateShareResponse {
  shareToken:   string;
  shareUrl:     string;
  expiresAt:    string | null;
  maxDownloads: number | null;
  createdAt:    string;
}

/**
 * Public share metadata — returned by GET /v1/share/{token}.
 * All crypto blobs are server-opaque; only the password holder can use them.
 */
export interface ShareMetadata {
  shareToken:       string;
  isFolder:         boolean;
  shareSaltB64:     string;
  shareWrappedDek:  string;
  shareIvDek:       string;
  shareEncFilename: string;
  shareIvFilename:  string;
  mimeType:         string | null;
  totalChunks:      number;
  totalSize:        number;
  expiresAt:        string | null;
  maxDownloads:     number | null;
  downloadCount:    number;
}

// ── API Methods ─────────────────────────────────────────────────────────────

export const shareApi = {

  /**
   * Creates a password-protected share for a file.
   * All crypto computation is done on the caller's side before this call.
   * Requires authentication (JWT in apiClient interceptor).
   */
  async createShare(req: CreateShareRequest): Promise<CreateShareResponse> {
    const res = await apiClient.post<CreateShareResponse>('v1/share', req);
    return res.data;
  },

  /**
   * Lists all shares created by the authenticated user.
   */
  async listMyShares(): Promise<ShareMetadata[]> {
    const res = await apiClient.get<ShareMetadata[]>('v1/share');
    return res.data;
  },

  /**
   * Fetches public share metadata by token.
   * No authentication required — uses plain fetch without JWT.
   * Called from the public /share/[token] page.
   */
  async getShareMetadata(token: string): Promise<ShareMetadata> {
    const res = await axios.get<ShareMetadata>(
      `${PUBLIC_BASE}/v1/share/${token}`,
      { headers: { 'Accept': 'application/json' } }
    );
    return res.data;
  },

  /**
   * Revokes (deletes) a share by token. Owner JWT required.
   */
  async revokeShare(token: string): Promise<void> {
    await apiClient.delete(`v1/share/${token}`);
  },

  /**
   * Returns the full URL for streaming a share chunk.
   * Used in the download pipeline on the public /share/[token] page.
   */
  getShareChunkStreamUrl(token: string, chunkIndex: number): string {
    return `${PUBLIC_BASE}/v1/share/${token}/chunk/${chunkIndex}/stream`;
  },
};
