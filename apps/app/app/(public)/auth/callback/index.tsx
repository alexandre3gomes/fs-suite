import * as Sentry from '@sentry/react-native';
import { useLocalSearchParams, useRootNavigationState, useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { exchangeAuthCode } from '../../../../src/services/auth.service';

export default function AuthCallbackScreen(): JSX.Element {
  const { code, error } = useLocalSearchParams<{ code?: string; error?: string }>();
  const router = useRouter();
  const handled = useRef(false);
  // On web, Google redirects directly to /auth/callback — this screen
  // mounts before the Root Layout's navigator. Gating on the root key
  // defers router.replace() until the navigation tree is ready.
  const navigatorReady = !!useRootNavigationState()?.key;

  useEffect(() => {
    if (!navigatorReady) return;
    if (handled.current) return;
    handled.current = true;

    // OAuth callback failed on the API side (passport rejected the Google
    // code — typically back-button or double-click). The API filter
    // already swallowed the noise; don't re-report it here, just bounce
    // back to login.
    if (error) {
      router.replace('/(public)/login');
      return;
    }

    if (!code) {
      router.replace('/(public)/login');
      return;
    }

    exchangeAuthCode(code)
      .then(() => {
        router.replace('/(auth)/dashboard');
      })
      .catch((err: unknown) => {
        Sentry.captureException(err, { tags: { context: 'auth_callback' } });
        router.replace('/(public)/login');
      });
  }, [code, error, router, navigatorReady]);

  return (
    <View className="flex-1 items-center justify-center bg-background">
      <ActivityIndicator size="large" color="#2563eb" />
    </View>
  );
}
