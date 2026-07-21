import * as Sentry from '@sentry/react-native';
import Constants from 'expo-constants';

import { useAuthStore } from '../stores/auth.store';

const API_URL =
  (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl ??
  process.env['EXPO_PUBLIC_API_URL'] ??
  'http://localhost:3001';

class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function extractErrorMessage(body: Record<string, unknown>, fallback: string): string {
  if (typeof body.message === 'string') return body.message;
  if (body.message && typeof body.message === 'object') {
    // NestJS wraps Zod fieldErrors under a message key
    return Object.entries(body.message as Record<string, string[]>)
      .map(([k, v]) => `${k}: ${v.join(', ')}`)
      .join('; ');
  }
  // Zod fieldErrors returned directly as the body (no message key)
  const fieldErrors = Object.entries(body).filter(([, v]) => Array.isArray(v));
  if (fieldErrors.length > 0) {
    return fieldErrors.map(([k, v]) => `${k}: ${(v as string[]).join(', ')}`).join('; ');
  }
  return fallback;
}

let refreshPromise: Promise<string | null> | null = null;

async function attemptRefresh(): Promise<string | null> {
  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = (async () => {
    try {
      const { refreshAccessToken } = await import('./auth.service');
      return await refreshAccessToken();
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  _isRetry = false,
): Promise<T> {
  const { accessToken } = useAuthStore.getState();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }

  const response = await fetch(`${API_URL}/v1${path}`, {
    ...options,
    headers,
    credentials: 'include',
  });

  if (response.status === 401 && !_isRetry && accessToken) {
    const newToken = await attemptRefresh();
    if (newToken) {
      return request<T>(path, options, true);
    }
    useAuthStore.getState().clear();
  }

  if (!response.ok) {
    const body = await response.json().catch(() => ({ message: response.statusText })) as Record<string, unknown>;
    const error = new ApiError(response.status, extractErrorMessage(body, response.statusText));
    if (response.status >= 500) {
      Sentry.captureException(error, {
        tags: { api_path: path, status_code: response.status },
      });
    }
    throw error;
  }

  if (response.status === 204) {
    return undefined as unknown as T;
  }

  return response.json() as Promise<T>;
}

/**
 * POST multipart/form-data with the JWT attached. Content-Type is left unset so
 * the runtime adds the correct `multipart/form-data; boundary=...`. Mirrors
 * `request`'s 401-refresh-retry behaviour.
 */
async function postForm<T>(path: string, formData: FormData, _isRetry = false): Promise<T> {
  const { accessToken } = useAuthStore.getState();

  const headers: Record<string, string> = {};
  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }

  const response = await fetch(`${API_URL}/v1${path}`, {
    method: 'POST',
    headers,
    credentials: 'include',
    body: formData,
  });

  if (response.status === 401 && !_isRetry && accessToken) {
    const newToken = await attemptRefresh();
    if (newToken) {
      return postForm<T>(path, formData, true);
    }
    useAuthStore.getState().clear();
  }

  if (!response.ok) {
    const data = await response.json().catch(() => ({ message: response.statusText })) as Record<string, unknown>;
    const error = new ApiError(response.status, extractErrorMessage(data, response.statusText));
    if (response.status >= 500) {
      Sentry.captureException(error, { tags: { api_path: path, status_code: response.status } });
    }
    throw error;
  }

  if (response.status === 204) {
    return undefined as unknown as T;
  }

  return response.json() as Promise<T>;
}

/** GET a binary resource (e.g. an admin-gated attachment) as a Blob, with auth. */
async function getBlob(path: string, _isRetry = false): Promise<Blob> {
  const { accessToken } = useAuthStore.getState();

  const headers: Record<string, string> = {};
  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }

  const response = await fetch(`${API_URL}/v1${path}`, { headers, credentials: 'include' });

  if (response.status === 401 && !_isRetry && accessToken) {
    const newToken = await attemptRefresh();
    if (newToken) {
      return getBlob(path, true);
    }
    useAuthStore.getState().clear();
  }

  if (!response.ok) {
    throw new ApiError(response.status, response.statusText);
  }

  return response.blob();
}

async function rawPost<T>(path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  const response = await fetch(`${API_URL}/v1${path}`, {
    method: 'POST',
    headers,
    credentials: 'include',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({ message: response.statusText })) as { message?: string };
    throw new ApiError(response.status, data.message ?? response.statusText);
  }

  if (response.status === 204) {
    return undefined as unknown as T;
  }

  return response.json() as Promise<T>;
}

export const apiClient = {
  get: <T>(path: string, options?: RequestInit): Promise<T> =>
    request<T>(path, { ...options, method: 'GET' }),

  post: <T>(path: string, body?: unknown, options?: RequestInit): Promise<T> =>
    request<T>(path, {
      ...options,
      method: 'POST',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),

  patch: <T>(path: string, body?: unknown, options?: RequestInit): Promise<T> =>
    request<T>(path, {
      ...options,
      method: 'PATCH',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),

  delete: <T>(path: string, options?: RequestInit): Promise<T> =>
    request<T>(path, { ...options, method: 'DELETE' }),

  postForm,
  getBlob,
  rawPost,
};

export { API_URL, ApiError };
