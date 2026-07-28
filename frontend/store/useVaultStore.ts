/**
 * store/useVaultStore.ts
 * Zustand global state for the ZK Vault UI.
 *
 * Owns: session KEK, upload queue, multi-select, view preferences, UI overlay flags.
 * Does NOT own: server data (owned by TanStack Query).
 */

'use client';

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type {
  PendingUpload, UploadPhase, ViewMode, SortField, SortOrder, StorageQuota
} from '@/types/vault';

// ── Store Shape ────────────────────────────────────────────────────────────

interface VaultStore {
  // ── Auth / Session ────────────────────────────────────────────────────────
  /** KEK lives only in RAM — never persisted to localStorage/sessionStorage */
  kek:         CryptoKey | null;
  /** RSA Private Key for receiving shares */
  privateKey:  CryptoKey | null;
  userId:      string | null;
  userEmail:   string | null;
  storageQuota: StorageQuota;

  // ── Upload Queue ──────────────────────────────────────────────────────────
  /** Map<localId, PendingUpload> for O(1) updates */
  uploads:     Map<string, PendingUpload>;

  // ── Pending Uploads Queue (Pre-upload) ─────────────────────────────────────
  filesToUpload:     File[];
  setFilesToUpload:  (files: File[]) => void;
  clearFilesToUpload: () => void;

  // ── File Explorer ─────────────────────────────────────────────────────────
  currentView:    'files' | 'trash';
  currentFolderId: string | null;
  folderBreadcrumbs: { id: string, name: string }[];
  selectedIds:    Set<string>;
  viewMode:       ViewMode;
  sortField:      SortField;
  sortOrder:      SortOrder;
  filterQuery:    string;
  mimeFilter:     'all' | 'images' | 'documents' | 'videos' | 'archives';
  previewFileId:  string | null;

  // ── UI Overlays ───────────────────────────────────────────────────────────
  isCommandOpen: boolean;
  isDragOver:    boolean;
  /** Drag-enter/leave counter — prevents flicker from child element transitions */
  dragDepth:     number;
  isHUDMinimised: boolean;

  // ── Actions: Session ──────────────────────────────────────────────────────
  setKek:         (kek: CryptoKey | null) => void;
  setPrivateKey:  (pk: CryptoKey | null) => void;
  setUser:        (id: string, email: string) => void;
  setQuota:       (q: StorageQuota) => void;
  logout:         () => void;

  // ── Actions: Uploads ──────────────────────────────────────────────────────
  addUpload:           (upload: PendingUpload) => void;
  updateUpload:        (localId: string, patch: Partial<PendingUpload>) => void;
  setUploadPhase:      (localId: string, phase: UploadPhase) => void;
  advanceChunk:        (localId: string, chunk: number, progress: number) => void;
  setUploadMetrics:    (localId: string, encryptMBs: number, uploadMBs: number, etaS: number | null) => void;
  removeUpload:        (localId: string) => void;
  pauseUpload:         (localId: string) => void;
  resumeUpload:        (localId: string) => void;
  cancelUpload:        (localId: string) => void;

  // ── Actions: Folders & Views ─────────────────────────────────────────────
  setCurrentView:       (view: 'files' | 'trash') => void;
  setCurrentFolderId:   (id: string | null) => void;
  pushFolder:           (id: string, name: string) => void;
  navigateToBreadcrumb: (index: number) => void;

  // ── Actions: Selection ────────────────────────────────────────────────────
  selectFile:       (id: string) => void;
  toggleFile:       (id: string) => void;
  rangeSelect:      (ids: string[]) => void;
  clearSelection:   () => void;
  selectAll:        (ids: string[]) => void;

  // ── Actions: UI ───────────────────────────────────────────────────────────
  setViewMode:        (v: ViewMode) => void;
  setSortField:       (f: SortField) => void;
  setSortOrder:       (o: SortOrder) => void;
  setFilterQuery:     (q: string) => void;
  setMimeFilter:      (f: VaultStore['mimeFilter']) => void;
  setPreviewFileId:   (id: string | null) => void;
  setCommandOpen:     (open: boolean) => void;
  setDragOver:        (enter: boolean) => void;
  toggleHUDMinimised: () => void;
}

// ── Store Factory ──────────────────────────────────────────────────────────

export const useVaultStore = create<VaultStore>()(
  subscribeWithSelector((set, get) => ({

    // ── Auth / Session ────────────────────────────────────────────────────────
    kek:           null,
    privateKey:    null,
    userId:        null,
    userEmail:     null,
    storageQuota: { used: 0, total: 10 * 1024 ** 3 }, // 10 GiB default

    uploads:      new Map(),

    currentView:       'files',
    currentFolderId:   null,
    folderBreadcrumbs: [],
    selectedIds:       new Set(),
    viewMode:          'grid',
    sortField:         'date',
    sortOrder:         'desc',
    filterQuery:       '',
    mimeFilter:        'all',
    previewFileId:     null,

    isCommandOpen:   false,
    isDragOver:      false,
    dragDepth:       0,
    isHUDMinimised:  false,

    // ── Session ───────────────────────────────────────────────────────────────
    setKek:   (kek)           => set({ kek }),
    setPrivateKey: (pk)       => set({ privateKey: pk }),
    setUser:  (userId, email) => set({ userId, userEmail: email }),
    setQuota: (q)             => set({ storageQuota: q }),
    logout:   ()              => set({
      kek: null, userId: null, userEmail: null,
      uploads: new Map(), selectedIds: new Set(),
      currentFolderId: null, folderBreadcrumbs: [],
      filesToUpload: [],
    }),

    // ── Pending Uploads ───────────────────────────────────────────────────────
    filesToUpload: [],
    setFilesToUpload: (files) => set({ filesToUpload: files }),
    clearFilesToUpload: () => set({ filesToUpload: [] }),

    // ── Upload Queue ──────────────────────────────────────────────────────────
    addUpload: (upload) => set(s => {
      const m = new Map(s.uploads);
      m.set(upload.localId, upload);
      return { uploads: m };
    }),

    updateUpload: (localId, patch) => set(s => {
      const m   = new Map(s.uploads);
      const cur = m.get(localId);
      if (!cur) return {};
      m.set(localId, { ...cur, ...patch });
      return { uploads: m };
    }),

    setUploadPhase: (localId, phase) => set(s => {
      const m   = new Map(s.uploads);
      const cur = m.get(localId);
      if (!cur) return {};
      m.set(localId, { ...cur, phase });
      return { uploads: m };
    }),

    advanceChunk: (localId, chunk, progress) => set(s => {
      const m   = new Map(s.uploads);
      const cur = m.get(localId);
      if (!cur) return {};
      m.set(localId, { ...cur, currentChunk: chunk, overallProgress: progress });
      return { uploads: m };
    }),

    setUploadMetrics: (localId, encryptMBs, uploadMBs, etaS) => set(s => {
      const m   = new Map(s.uploads);
      const cur = m.get(localId);
      if (!cur) return {};
      m.set(localId, { ...cur, encryptSpeedMBs: encryptMBs, uploadSpeedMBs: uploadMBs, etaSeconds: etaS });
      return { uploads: m };
    }),

    removeUpload: (localId) => set(s => {
      const m = new Map(s.uploads);
      m.delete(localId);
      return { uploads: m };
    }),

    pauseUpload: (localId) => set(s => {
      const m   = new Map(s.uploads);
      const cur = m.get(localId);
      if (!cur) return {};
      m.set(localId, { ...cur, paused: true, phase: 'paused' });
      return { uploads: m };
    }),

    resumeUpload: (localId) => set(s => {
      const m   = new Map(s.uploads);
      const cur = m.get(localId);
      if (!cur) return {};
      m.set(localId, { ...cur, paused: false, phase: 'encrypting' });
      return { uploads: m };
    }),

    cancelUpload: (localId) => {
      const { uploads, removeUpload } = get();
      const upload = uploads.get(localId);
      upload?.abortController?.abort();
      removeUpload(localId);
    },

    // ── Folders & Views ──────────────────────────────────────────────────────
    setCurrentView: (view) => set({ currentView: view, currentFolderId: null, folderBreadcrumbs: [], selectedIds: new Set() }),
    setCurrentFolderId: (id) => set({ currentFolderId: id }),
    pushFolder: (id, name) => set((s) => ({
      currentFolderId: id,
      folderBreadcrumbs: [...s.folderBreadcrumbs, { id, name }]
    })),
    navigateToBreadcrumb: (index) => set((s) => {
      if (index === -1) {
        return { currentFolderId: null, folderBreadcrumbs: [] };
      }
      const newCrumbs = s.folderBreadcrumbs.slice(0, index + 1);
      return {
        currentFolderId: newCrumbs[newCrumbs.length - 1].id,
        folderBreadcrumbs: newCrumbs
      };
    }),

    // ── Selection ─────────────────────────────────────────────────────────────
    selectFile: (id)  => set({ selectedIds: new Set([id]) }),

    toggleFile: (id)  => set(s => {
      const next = new Set(s.selectedIds);
      next.has(id) ? next.delete(id) : next.add(id);
      return { selectedIds: next };
    }),

    rangeSelect: (ids) => set(s => {
      const next = new Set(s.selectedIds);
      ids.forEach(id => next.add(id));
      return { selectedIds: next };
    }),

    clearSelection: () => set({ selectedIds: new Set() }),
    selectAll:  (ids) => set({ selectedIds: new Set(ids) }),

    // ── UI ────────────────────────────────────────────────────────────────────
    setViewMode:      (v) => set({ viewMode: v }),
    setSortField:     (f) => set({ sortField: f }),
    setSortOrder:     (o) => set({ sortOrder: o }),
    setFilterQuery:   (q) => set({ filterQuery: q }),
    setMimeFilter:    (f) => set({ mimeFilter: f }),
    setPreviewFileId: (id) => set({ previewFileId: id }),
    setCommandOpen:   (open) => set({ isCommandOpen: open }),

    setDragOver: (enter) => set(s => {
      const depth = s.dragDepth + (enter ? 1 : -1);
      return { dragDepth: Math.max(0, depth), isDragOver: depth > 0 };
    }),

    toggleHUDMinimised: () => set(s => ({ isHUDMinimised: !s.isHUDMinimised })),
  }))
);

// ── Convenience Selectors (memoised outside the hook to avoid re-renders) ──

export const selectActiveUploads = (s: VaultStore) =>
  Array.from(s.uploads.values()).filter(u => u.phase !== 'done');

export const selectUploadCount = (s: VaultStore) => s.uploads.size;
export const selectKek         = (s: VaultStore) => s.kek;
export const selectViewMode    = (s: VaultStore) => s.viewMode;
export const selectSelectedIds = (s: VaultStore) => s.selectedIds;
