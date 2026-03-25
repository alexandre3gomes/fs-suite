import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { handleWebCallback } from '../../../../src/services/auth.service';

export default function AuthCallbackScreen(): JSX.Element {
  const { access_token } = useLocalSearchParams<{ access_token?: string }>();
  const router = useRouter();
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;

    if (!access_token) {
      router.replace('/(public)/login');
      return;
    }

    handleWebCallback(access_token)
      .then(() => {
        router.replace('/(auth)/dashboard');
      })
      .catch(() => {
        router.replace('/(public)/login');
      });
  }, [access_token, router]);

  return (
    <View className="flex-1 items-center justify-center bg-background">
      <ActivityIndicator size="large" color="#4a90e2" />
    </View>
  );
}
