import apiClient from './client';
import { z } from 'zod';

export const folderSchema = z.object({
  id: z.string().uuid(),
  parentId: z.string().uuid().nullable(),
  nameEncrypted: z.string(),
  iv: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type Folder = z.infer<typeof folderSchema>;

export const foldersApi = {
  listFolders: async (parentId?: string, deleted: boolean = false): Promise<Folder[]> => {
    const params = { ...(parentId && { parentId }), deleted };
    const { data } = await apiClient.get<Folder[]>('/v1/folders', { params });
    return data;
  },

  createFolder: async (payload: { nameEncrypted: string; iv: string; parentId?: string | null }): Promise<Folder> => {
    const { data } = await apiClient.post<Folder>('/v1/folders', payload);
    return data;
  },

  getFolder: async (id: string): Promise<Folder> => {
    const { data } = await apiClient.get<Folder>(`/v1/folders/${id}`);
    return data;
  },

  deleteFolder: async (id: string): Promise<void> => {
    await apiClient.delete(`/v1/folders/${id}`);
  },

  restoreFolder: async (id: string): Promise<void> => {
    await apiClient.post(`/v1/folders/${id}/restore`);
  },

  hardDeleteFolder: async (id: string): Promise<void> => {
    await apiClient.delete(`/v1/folders/${id}/force`);
  }
};
