import * as Sentry from '@sentry/react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { exchangeAuthCode } from '../../../../src/services/auth.service';

export default function AuthCallbackScreen(): JSX.Element {
  const { code } = useLocalSearchParams<{ code?: string }>();
  const router = useRouter();
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;

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
  }, [code, router]);

  return (
    <View className="flex-1 items-center justify-center bg-background">
      <ActivityIndicator size="large" color="#2563eb" />
    </View>
  );
}
