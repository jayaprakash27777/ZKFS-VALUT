/**
 * lib/api/files.ts
 *
 * File management API methods — aligned with the Spring Boot FileController.
 *
 * Endpoint mapping (all under /api context-path, /v1/files prefix):
 *   POST   /v1/files/initiate               → initiateUpload()
 *   POST   /v1/files/{id}/chunk/{idx}       → uploadChunk()    (multipart)
 *   POST   /v1/files/{id}/complete          → completeUpload()
 *   GET    /v1/files                        → listFiles()
 *   GET    /v1/files/{id}                   → getFile()
 *   GET    /v1/files/{id}/chunks            → getChunks()
 *   GET    /v1/files/{id}/chunk/{idx}/stream → downloadChunkStream()
 *   GET    /v1/files/{id}/chunk/{idx}/url   → getChunkDownloadUrl()
 *   DELETE /v1/files/{id}                   → deleteFile()
 */

import apiClient from './client';

// ── Types ──────────────────────────────────────────────────────────────────

export interface InitiateUploadRequest {
  filenameEncrypted: string;  // Base64(AES-GCM(filename)) — opaque to server
  thumbnailEncrypted?: string;
  mimeType?:         string;  // Optional MIME hint (plaintext, not sensitive)
  totalChunks:       number;
  totalSize:         number;  // Original file size in bytes
  wrappedDek:        string;  // Base64(AES-GCM-wrapped DEK)
  ivWrappedDek:      string;  // Base64(12-byte IV used to wrap DEK)
  folderId?:         string;  // Optional parent folder UUID
  isPasswordProtected?: boolean;
  passwordSalt?:     string;
  isPasskeyProtected?: boolean;
  passkeySalt?:      string;
}

/**
 * Matches InitiateUploadResponse from backend:
 * { fileId, status, totalChunks, createdAt }
 *
 * IMPORTANT: backend uses "fileId" NOT "id"
 */
export interface InitiateUploadResponse {
  fileId:      string;   // ← backend returns "fileId"
  status:      string;
  totalChunks: number;
  createdAt:   string;
}

/**
 * Matches FileMetadataDto from backend — returned by list, get, complete.
 */
export interface FileMetadataResponse {
  id:                string;
  filenameEncrypted: string;
  mimeType:          string | null;
  thumbnailEncrypted?: string;
  totalChunks:       number;
  totalSize:         number;
  wrappedDek:        string;
  ivWrappedDek:      string;
  uploadStatus:      'UPLOADING' | 'COMPLETE' | 'FAILED';
  createdAt:         string;
  updatedAt:         string;
  folderId:          string | null;
  isPasswordProtected: boolean;
  passwordSalt?:     string | null;
  isPasskeyProtected: boolean;
  passkeySalt?:      string | null;
}

/**
 * Matches ChunkUploadResponse from backend.
 */
export interface ChunkUploadResponse {
  id:          string;
  fileId:      string;
  chunkIndex:  number;
  chunkSize:   number;
}

/**
 * Matches ChunkInfo record from FileController.getChunks().
 */
export interface ChunkMetadataResponse {
  id:             string;
  chunkIndex:     number;
  chunkSize:      number;
  ivChunk:        string;  // Base64 12-byte IV
  sha256Checksum: string;  // Hex SHA-256
}

export interface PagedResponse<T> {
  content:          T[];
  totalElements:    number;
  totalPages:       number;
  number:           number;  // zero-based page number (Spring uses "number")
  size:             number;
}

// ── API Methods ────────────────────────────────────────────────────────────

export const filesApi = {

  /**
   * Step 1: Register file metadata with the server before uploading chunks.
   * Returns an InitiateUploadResponse with the server-assigned fileId.
   *
   * Backend: POST /v1/files/initiate
   */
  async initiateUpload(request: InitiateUploadRequest): Promise<InitiateUploadResponse> {
    const { data } = await apiClient.post<InitiateUploadResponse>('v1/files/initiate', request);
    return data;
  },

  /**
   * Step 2: Upload a single encrypted chunk as multipart/form-data.
   *
   * Backend: POST /v1/files/{fileId}/chunk/{chunkIndex}
   *   - Part:  chunk      = binary encrypted wire frame [12-byte IV || ciphertext+tag]
   *   - Param: sha256Checksum = 64-char hex SHA-256
   *   - Param: ivChunk       = Base64 12-byte IV
   *
   * Note: sha256Checksum and ivChunk are @RequestParam (query params or form params),
   * NOT @RequestPart — so they go in FormData alongside the binary.
   */
  async uploadChunk(
    fileId:     string,
    chunkIndex: number,
    ciphertext: ArrayBuffer,
    ivB64:      string,
    sha256Hex:  string
  ): Promise<ChunkUploadResponse> {
    const blob     = new Blob([ciphertext], { type: 'application/octet-stream' });
    const formData = new FormData();
    formData.append('chunk',          blob, `chunk-${chunkIndex}.enc`);
    formData.append('sha256Checksum', sha256Hex);
    formData.append('ivChunk',        ivB64);

    const { data } = await apiClient.post<ChunkUploadResponse>(
      `v1/files/${fileId}/chunk/${chunkIndex}`,
      formData,
      {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      }
    );
    return data;
  },

  /**
   * Step 3: Mark upload as complete after all chunks are uploaded.
   * Server validates chunk count before accepting.
   *
   * Backend: POST /v1/files/{fileId}/complete  (POST, not PATCH)
   */
  async completeUpload(fileId: string): Promise<FileMetadataResponse> {
    const { data } = await apiClient.post<FileMetadataResponse>(
      `v1/files/${fileId}/complete`
    );
    return data;
  },

  /**
   * List files for the authenticated user (paginated, sorted by createdAt DESC).
   *
   * Backend: GET /v1/files?page=0&size=20
   */
  async listFiles(page = 0, size = 20, folderId?: string, deleted = false): Promise<PagedResponse<FileMetadataResponse>> {
    const { data } = await apiClient.get<PagedResponse<FileMetadataResponse>>('v1/files', {
      params: { page, size, ...(folderId && { folderId }), deleted },
    });
    return data;
  },

  /** Get metadata for a single file. */
  async getFile(fileId: string): Promise<FileMetadataResponse> {
    const { data } = await apiClient.get<FileMetadataResponse>(`v1/files/${fileId}`);
    return data;
  },

  /**
   * Get ordered chunk metadata for a file (used by download orchestrator).
   *
   * Backend: GET /v1/files/{fileId}/chunks
   * Returns: ChunkInfo[] ordered by chunkIndex ascending
   */
  async getChunks(fileId: string): Promise<ChunkMetadataResponse[]> {
    const { data } = await apiClient.get<ChunkMetadataResponse[]>(`v1/files/${fileId}/chunks`);
    return data;
  },

  /**
   * Stream a single encrypted chunk directly from MinIO through Spring backend.
   * Returns raw ArrayBuffer — the browser decrypts it with the session DEK.
   *
   * Backend: GET /v1/files/{fileId}/chunk/{chunkIndex}/stream
   * Response headers carry: X-IV-Chunk, X-SHA256-Checksum, X-Chunk-Index, Content-Length
   */
  async downloadChunkStream(fileId: string, chunkIndex: number): Promise<ArrayBuffer> {
    const { data } = await apiClient.get<ArrayBuffer>(
      `v1/files/${fileId}/chunk/${chunkIndex}/stream`,
      { responseType: 'arraybuffer' }
    );
    return data;
  },

  /**
   * Get a presigned MinIO URL for direct chunk download (bypasses Spring server).
   * The client can use this URL to download the encrypted wire frame directly.
   *
   * Backend: GET /v1/files/{fileId}/chunk/{chunkIndex}/url
   */
  async getChunkDownloadUrl(fileId: string, chunkIndex: number): Promise<string> {
    const { data } = await apiClient.get<{ url: string; fileId: string; chunkIndex: string }>(
      `v1/files/${fileId}/chunk/${chunkIndex}/url`
    );
    return data.url;
  },

  /**
   * Soft delete a file.
   *
   * Backend: DELETE /v1/files/{fileId}
   * Response: 204 No Content
   */
  async deleteFile(fileId: string): Promise<void> {
    await apiClient.delete(`v1/files/${fileId}`);
  },

  /**
   * Restore a soft-deleted file.
   */
  async restoreFile(fileId: string): Promise<void> {
    await apiClient.post(`v1/files/${fileId}/restore`);
  },

  /**
   * Permanently delete a file.
   */
  async hardDeleteFile(fileId: string): Promise<void> {
    await apiClient.delete(`v1/files/${fileId}/force`);
  },

  async shareFileWithUser(fileId: string, email: string, wrappedDek: string): Promise<void> {
    await apiClient.post(`v1/files/${fileId}/share/user`, { email, wrappedDek });
  },

  async getSharedFiles(): Promise<any[]> {
    const { data } = await apiClient.get<any[]>('v1/files/shared');
    return data;
  }
};
