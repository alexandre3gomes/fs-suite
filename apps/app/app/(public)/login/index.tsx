import { Redirect } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { signInWithGoogle } from '../../../src/services/auth.service';
import { useAuthStore } from '../../../src/stores/auth.store';

export default function LoginScreen(): JSX.Element {
  const { t } = useTranslation();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const [loading, setLoading] = useState(false);

  if (isAuthenticated) {
    return <Redirect href="/(auth)/dashboard" />;
  }

  const handleSignIn = async (): Promise<void> => {
    setLoading(true);
    try {
      await signInWithGoogle();
    } finally {
      setLoading(false);
    }
  };

  return (
    <View className="flex-1 items-center justify-center bg-background px-6">
      <View className="w-full max-w-sm items-center gap-8">
        <View className="items-center gap-2">
          <Text className="text-4xl font-bold text-foreground">{t('login.title')}</Text>
          <Text className="text-center text-muted-foreground">{t('login.subtitle')}</Text>
        </View>

        <Pressable
          className="w-full flex-row items-center justify-center gap-3 rounded-button bg-primary px-6 py-3 disabled:opacity-50"
          onPress={() => { void handleSignIn(); }}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator size="small" color="#ffffff" />
          ) : (
            <Text className="text-base font-medium text-primary-foreground">
              {t('login.signInButton')}
            </Text>
          )}
        </Pressable>

        <Text className="text-center text-xs text-muted-foreground">{t('login.terms')}</Text>
      </View>
    </View>
  );
}
