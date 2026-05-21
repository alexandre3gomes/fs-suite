import '../global.css';
import '@/i18n';

import * as Sentry from '@sentry/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack, usePathname } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import i18n from 'i18next';
import { Component, useEffect, useRef, useState } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { Text, View } from 'react-native';

import { restoreLanguage } from '../src/i18n';
import { initAnalytics, trackScreenView, setSessionContext } from '../src/services/analytics';
import { refreshAccessToken } from '../src/services/auth.service';
import { useAuthStore } from '../src/stores/auth.store';
import { restoreUnits } from '../src/stores/units.store';

Sentry.init({
  dsn: process.env['EXPO_PUBLIC_SENTRY_DSN'],
  environment: process.env['NODE_ENV'] ?? 'development',
  enabled: process.env['NODE_ENV'] === 'production',
  release: process.env['EXPO_PUBLIC_SENTRY_RELEASE'] ?? undefined,
  tracesSampleRate: 0.2,
  beforeSend(event) {
    if (event.request?.headers) {
      delete event.request.headers['authorization'];
      delete event.request.headers['cookie'];
    }
    return event;
  },
});

SplashScreen.preventAutoHideAsync();

interface ErrorBoundaryState {
  hasError: boolean;
}

class AppErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    Sentry.captureException(error, {
      contexts: { react: { componentStack: info.componentStack ?? undefined } },
    });
  }

  override render(): ReactNode {
    if (this.state.hasError) {
      return (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f8f9fb' }}>
          <Text style={{ color: '#1a1d26', fontSize: 18, fontWeight: '600', marginBottom: 8 }}>
            {i18n.t('common.errorBoundaryTitle')}
          </Text>
          <Text style={{ color: '#6b7280', fontSize: 14 }}>
            {i18n.t('common.errorBoundaryMessage')}
          </Text>
        </View>
      );
    }
    return this.props.children;
  }
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      retry: 1,
    },
  },
});

function ScreenTracker(): null {
  const pathname = usePathname();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  useEffect(() => {
    setSessionContext({ authenticated: isAuthenticated });
    if (pathname) trackScreenView(pathname);
  }, [pathname, isAuthenticated]);
  return null;
}

function RootLayout(): JSX.Element | null {
  const [ready, setReady] = useState(false);
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    void initAnalytics();

    // Restore persisted language + attempt silent token refresh
    Promise.all([restoreLanguage(), restoreUnits(), refreshAccessToken().catch(() => undefined)])
      .finally(() => {
        setReady(true);
        void SplashScreen.hideAsync();
      });
  }, []);

  if (!ready) return null;

  return (
    <AppErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ScreenTracker />
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="(public)" />
          <Stack.Screen name="(auth)" />
        </Stack>
      </QueryClientProvider>
    </AppErrorBoundary>
  );
}

export default Sentry.wrap(RootLayout);
