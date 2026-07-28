import apiClient from './client';

export const usersApi = {
  async getPublicKey(email: string): Promise<{ publicKey: string, id: string }> {
    const { data } = await apiClient.get<{ publicKey: string, id: string }>('v1/users/public-key', {
      params: { email }
    });
    return data;
  }
};
