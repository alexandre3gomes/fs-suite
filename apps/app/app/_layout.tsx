import '../global.css';
import '@/i18n';

import * as Sentry from '@sentry/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useRef, useState } from 'react';

import { refreshAccessToken } from '../src/services/auth.service';

Sentry.init({
  dsn: process.env['EXPO_PUBLIC_SENTRY_DSN'],
  enabled: process.env['NODE_ENV'] === 'production',
});

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      retry: 1,
    },
  },
});

function RootLayout(): JSX.Element | null {
  const [ready, setReady] = useState(false);
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    // Attempt silent token refresh on app start (restores session if valid)
    refreshAccessToken()
      .catch(() => undefined)
      .finally(() => {
        setReady(true);
        void SplashScreen.hideAsync();
      });
  }, []);

  if (!ready) return null;

  return (
    <QueryClientProvider client={queryClient}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(public)" />
        <Stack.Screen name="(auth)" />
      </Stack>
    </QueryClientProvider>
  );
}

export default Sentry.wrap(RootLayout);
