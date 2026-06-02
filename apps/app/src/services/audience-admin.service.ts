import { apiClient } from './api.client';

export interface AudienceSyncResult {
  total: number;
  ok: number;
  failed: number;
}

export const audienceAdminApi = {
  /** Backfill/reconcile all active users into the Resend marketing audience. */
  sync: (): Promise<AudienceSyncResult> => apiClient.post('/admin/audience/sync'),
};
