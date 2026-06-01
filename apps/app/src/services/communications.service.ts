import { apiClient } from './api.client';

export type CommunicationType = 'NEW_FEATURE';
export type CommunicationStatus = 'DRAFT' | 'SENT';

export interface CommunicationImage {
  url: string;
  path: string;
  caption?: string;
}

export interface Communication {
  id: string;
  type: CommunicationType;
  subject: string;
  body: string;
  images: CommunicationImage[];
  status: CommunicationStatus;
  createdByEmail: string;
  createdAt: string;
  sentAt: string | null;
}

export interface CommunicationListItem extends Communication {
  _count: { deliveries: number };
}

export interface SendResult {
  communicationId: string;
  eligible: number;
  alreadySent: number;
  pending: number;
  sent: number;
  failed: number;
  remaining: number;
  dryRun: boolean;
}

const BASE = '/admin/communications';

export const communicationsApi = {
  list: (): Promise<CommunicationListItem[]> => apiClient.get(BASE),

  get: (id: string): Promise<Communication> => apiClient.get(`${BASE}/${id}`),

  create: (input: {
    type: CommunicationType;
    subject: string;
    body: string;
  }): Promise<Communication> => apiClient.post(BASE, input),

  update: (
    id: string,
    input: Partial<{ type: CommunicationType; subject: string; body: string }>,
  ): Promise<Communication> => apiClient.patch(`${BASE}/${id}`, input),

  addImage: (
    id: string,
    input: { contentType: string; dataBase64: string; caption?: string },
  ): Promise<CommunicationImage> => apiClient.post(`${BASE}/${id}/images`, input),

  removeImage: (id: string, path: string): Promise<CommunicationImage[]> =>
    apiClient.delete(`${BASE}/${id}/images?path=${encodeURIComponent(path)}`),

  // Upload an inline image (for the body markdown) — returns the public URL,
  // does NOT touch the images array.
  uploadImage: (
    id: string,
    input: { contentType: string; dataBase64: string },
  ): Promise<{ url: string; path: string }> =>
    apiClient.post(`${BASE}/${id}/upload-image`, input),

  send: (id: string, dryRun: boolean, adminOnly = false): Promise<SendResult> =>
    apiClient.post(
      `${BASE}/${id}/send?dryRun=${dryRun ? 'true' : 'false'}&adminOnly=${adminOnly ? 'true' : 'false'}`,
    ),
};
