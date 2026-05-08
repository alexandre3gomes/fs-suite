import * as Sentry from '@sentry/react-native';
import * as Linking from 'expo-linking';
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';

import { useAuthStore } from '../stores/auth.store';

import { apiClient, API_URL } from './api.client';

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
    // Web: full-page redirect — no return value, browser navigates away
    (globalThis as unknown as { location: { href: string } }).location.href =
      `${API_URL}/v1/auth/google?platform=web`;
    return;
  }

  // Native: open in-app browser session, watch for deep link redirect
  const redirectUrl = Linking.createURL('auth/callback');
  const result = await WebBrowser.openAuthSessionAsync(
    `${API_URL}/v1/auth/google?platform=native`,
    redirectUrl,
  );

  if (result.type !== 'success') {
    return;
  }

  const url = new URL(result.url);
  const accessToken = url.searchParams.get('access_token');
  const refreshToken = url.searchParams.get('refresh_token');

  if (!accessToken) {
    return;
  }

  await handleNativeTokens(accessToken, refreshToken ?? null);
}

export async function handleNativeTokens(
  accessToken: string,
  refreshToken: string | null,
): Promise<void> {
  const { setTokens, setUser } = useAuthStore.getState();

  setTokens(accessToken);

  if (refreshToken) {
    await SecureStore.setItemAsync(SECURE_STORE_REFRESH_KEY, refreshToken);
  }

  const user = await apiClient.get<UserProfile>('/users/me');
  setUser(user);
}

export async function handleWebCallback(accessToken: string): Promise<void> {
  const { setTokens, setUser } = useAuthStore.getState();

  setTokens(accessToken);

  const user = await apiClient.get<UserProfile>('/users/me');
  setUser(user);
}

export async function refreshAccessToken(): Promise<string | null> {
  try {
    let body: { refreshToken?: string } | undefined;

    if (Platform.OS !== 'web') {
      const storedToken = await SecureStore.getItemAsync(SECURE_STORE_REFRESH_KEY);
      if (!storedToken) return null;
      body = { refreshToken: storedToken };
    }

    const { accessToken, refreshToken } = await apiClient.post<TokenResponse>(
      '/auth/refresh',
      body,
    );

    const { setTokens } = useAuthStore.getState();
    setTokens(accessToken);

    if (refreshToken && Platform.OS !== 'web') {
      await SecureStore.setItemAsync(SECURE_STORE_REFRESH_KEY, refreshToken);
    }

    return accessToken;
  } catch (err) {
    Sentry.captureException(err, { level: 'info', tags: { context: 'token_refresh' } });
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

    await apiClient.post('/auth/logout', body);
  } catch (err) {
    Sentry.captureException(err, { level: 'warning', tags: { context: 'logout' } });
  } finally {
    useAuthStore.getState().clear();
  }
}
