import { apiClient } from './api.client';

export type FeedbackType = 'BUG_REPORT' | 'SUGGESTION';
export type FeedbackStatus = 'OPEN' | 'ANSWERED' | 'RESOLVED';

/** A file chosen in the modal, normalized across web and native pickers. */
export interface PickedFile {
  name: string;
  mimeType: string;
  uri: string;
  /** Present on web (expo-document-picker exposes the underlying File). */
  file?: File | null;
  size?: number;
}

export interface FeedbackAttachment {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
}

export interface AdminFeedbackSummary {
  id: string;
  type: FeedbackType;
  status: FeedbackStatus;
  reporterName: string;
  reporterEmail: string;
  description: string;
  attachmentCount: number;
  hasReply: boolean;
  createdAt: string;
  repliedAt: string | null;
  resolvedAt: string | null;
}

export interface AdminFeedbackDetail extends AdminFeedbackSummary {
  adminReply: string | null;
  repliedByName: string | null;
  attachments: FeedbackAttachment[];
}

const BASE = '/feedback';
const ADMIN_BASE = '/admin/feedback';

export const feedbackApi = {
  submit: (params: {
    type: FeedbackType;
    description: string;
    files: PickedFile[];
  }): Promise<{ id: string }> => {
    const fd = new FormData();
    fd.append('type', params.type);
    fd.append('description', params.description);
    for (const f of params.files) {
      if (f.file) {
        // Web File carries its own name; no third arg needed.
        fd.append('files', f.file as unknown as Blob);
      } else {
        // React Native FormData file shape.
        fd.append('files', { uri: f.uri, name: f.name, type: f.mimeType } as unknown as Blob);
      }
    }
    return apiClient.postForm(BASE, fd);
  },

  listAdmin: (filters?: {
    status?: FeedbackStatus;
    type?: FeedbackType;
  }): Promise<AdminFeedbackSummary[]> => {
    const qs = new URLSearchParams();
    if (filters?.status) qs.set('status', filters.status);
    if (filters?.type) qs.set('type', filters.type);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return apiClient.get(`${ADMIN_BASE}${suffix}`);
  },

  getAdmin: (id: string): Promise<AdminFeedbackDetail> => apiClient.get(`${ADMIN_BASE}/${id}`),

  reply: (id: string, message: string): Promise<AdminFeedbackDetail> =>
    apiClient.post(`${ADMIN_BASE}/${id}/reply`, { message }),

  setStatus: (id: string, status: FeedbackStatus): Promise<AdminFeedbackDetail> =>
    apiClient.patch(`${ADMIN_BASE}/${id}/status`, { status }),

  /** Fetch an attachment as an object URL (admin-gated, so it needs the JWT). */
  attachmentObjectUrl: async (id: string, attachmentId: string): Promise<string> => {
    const blob = await apiClient.getBlob(`${ADMIN_BASE}/${id}/attachments/${attachmentId}`);
    return URL.createObjectURL(blob);
  },
};
