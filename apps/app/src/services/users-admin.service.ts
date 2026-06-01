import { apiClient } from './api.client';

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  createdAt: string;
  isAdmin: boolean;
}

const BASE = '/admin/users';

export const usersAdminApi = {
  list: (): Promise<AdminUser[]> => apiClient.get(BASE),

  setAdmin: (id: string, isAdmin: boolean): Promise<AdminUser> =>
    apiClient.patch(`${BASE}/${id}`, { isAdmin }),

  remove: (id: string): Promise<void> => apiClient.delete(`${BASE}/${id}`),
};
