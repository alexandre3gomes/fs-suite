import * as Sentry from '@sentry/react-native';
import * as Linking from 'expo-linking';
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';

import { useAuthStore } from '../stores/auth.store';

import { identifyUser, resetAnalytics } from './analytics';
import { apiClient, API_URL, ApiError } from './api.client';

const GOOGLE_AUTH_URL = API_URL.replace(/192\.168\.\d+\.\d+/, 'localhost');
const SECURE_STORE_REFRESH_KEY = 'fs_suite_refresh_token';

interface UserProfile {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
}

interface TokenResponse {
  accessToken: string;
  refreshToken?: string;
}

export async function signInWithGoogle(): Promise<void> {
  if (Platform.OS === 'web') {
    (globalThis as unknown as { location: { href: string } }).location.href =
      `${GOOGLE_AUTH_URL}/v1/auth/google?platform=web`;
    return;
  }

  const redirectUrl = Linking.createURL('auth/callback');
  const result = await WebBrowser.openAuthSessionAsync(
    `${GOOGLE_AUTH_URL}/v1/auth/google?platform=native`,
    redirectUrl,
  );

  if (result.type !== 'success') {
    return;
  }

  const url = new URL(result.url);
  const code = url.searchParams.get('code');
  if (!code) {
    return;
  }

  await exchangeAuthCodeNative(code);
}

export async function signInWithDev(): Promise<void> {
  if (Platform.OS === 'web') {
    (globalThis as unknown as { location: { href: string } }).location.href =
      `${API_URL}/v1/auth/dev-login?platform=web`;
    return;
  }

  const redirectUrl = Linking.createURL('auth/callback');
  const result = await WebBrowser.openAuthSessionAsync(
    `${API_URL}/v1/auth/dev-login?platform=native`,
    redirectUrl,
  );

  if (result.type !== 'success') {
    return;
  }

  const url = new URL(result.url);
  const code = url.searchParams.get('code');
  if (!code) {
    return;
  }

  await exchangeAuthCodeNative(code);
}

async function exchangeAuthCodeNative(code: string): Promise<void> {
  const { setTokens, setUser } = useAuthStore.getState();

  const response = await apiClient.rawPost<TokenResponse>('/auth/exchange', {
    code,
    platform: 'native',
  });

  setTokens(response.accessToken);

  if (response.refreshToken) {
    await SecureStore.setItemAsync(SECURE_STORE_REFRESH_KEY, response.refreshToken);
  }

  const user = await apiClient.get<UserProfile>('/users/me');
  setUser(user);
  identifyUser(user);
}

export async function exchangeAuthCode(code: string): Promise<void> {
  const { setTokens, setUser } = useAuthStore.getState();

  const response = await apiClient.rawPost<TokenResponse>('/auth/exchange', { code });
  setTokens(response.accessToken);

  const user = await apiClient.get<UserProfile>('/users/me');
  setUser(user);
  identifyUser(user);
}

export async function refreshAccessToken(): Promise<string | null> {
  try {
    let body: { refreshToken?: string } | undefined;

    if (Platform.OS !== 'web') {
      const storedToken = await SecureStore.getItemAsync(SECURE_STORE_REFRESH_KEY);
      if (!storedToken) return null;
      body = { refreshToken: storedToken };
    }

    const { accessToken, refreshToken } = await apiClient.rawPost<TokenResponse>(
      '/auth/refresh',
      body,
    );

    const { setTokens, user } = useAuthStore.getState();
    setTokens(accessToken);
    if (user) identifyUser(user);

    if (refreshToken && Platform.OS !== 'web') {
      await SecureStore.setItemAsync(SECURE_STORE_REFRESH_KEY, refreshToken);
    }

    return accessToken;
  } catch (err) {
    // 401 from /auth/refresh means "no valid session anymore" — the
    // refresh cookie expired, was cleared by the user, or the session
    // was revoked. Expected behaviour for any user whose session has
    // aged out. Don't report — caller redirects to login.
    //
    // Other errors (5xx, network failure, malformed response) ARE
    // worth knowing about: they may indicate API regressions.
    const isExpiredSession = err instanceof ApiError && err.status === 401;
    if (!isExpiredSession) {
      Sentry.captureException(err, { level: 'info', tags: { context: 'token_refresh' } });
    }
    return null;
  }
}

export async function signOut(): Promise<void> {
  try {
    let body: { refreshToken?: string } | undefined;

    if (Platform.OS !== 'web') {
      const storedToken = await SecureStore.getItemAsync(SECURE_STORE_REFRESH_KEY);
      if (storedToken) {
        body = { refreshToken: storedToken };
        await SecureStore.deleteItemAsync(SECURE_STORE_REFRESH_KEY);
      }
    }

    await apiClient.rawPost('/auth/logout', body);
  } catch (err) {
    Sentry.captureException(err, { level: 'warning', tags: { context: 'logout' } });
  } finally {
    useAuthStore.getState().clear();
    resetAnalytics();
  }
}
