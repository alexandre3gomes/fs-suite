import { Button, Card, CardContent, logoSource, Separator, Text } from '@fs-suite/ui';
import { Redirect } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Image, View } from 'react-native';

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
    <View className="flex-1 bg-background">
      {/* Background watermark logo */}
      <View
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: 0.04 }}
        pointerEvents="none"
      >
        <Image
          source={logoSource}
          style={{ width: '100%', height: '100%' }}
          resizeMode="contain"
          accessibilityLabel=""
          accessibilityElementsHidden
        />
      </View>

      {/* Foreground content */}
      <View className="flex-1 items-center justify-center px-6">
        <Card className="w-full max-w-sm border-0 bg-transparent shadow-none md:border md:border-border md:bg-card md:shadow-lg">
          <CardContent className="items-center px-6 py-10 md:px-10 md:py-12">
            {/* Branding */}
            <Text variant="h2" className="text-center tracking-tight">
              {t('login.title')}
            </Text>
            <Text variant="muted" className="mt-2 text-center">
              {t('login.subtitle')}
            </Text>

            <Separator className="my-8" />

            {/* Sign in button */}
            <Button
              variant="outline"
              size="lg"
              className="w-full gap-3 border-border bg-card shadow-sm"
              onPress={() => { void handleSignIn(); }}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator size="small" color="hsl(221.2, 83.2%, 53.3%)" />
              ) : (
                <Text style={{ fontSize: 18, fontWeight: '700', color: '#4285F4' }}>G</Text>
              )}
              <Text className="text-sm font-medium text-foreground">
                {t('login.signInButton')}
              </Text>
            </Button>

            {/* Terms */}
            <Text variant="muted" className="mt-8 text-center text-xs leading-5">
              {t('login.terms')}
            </Text>
          </CardContent>
        </Card>
      </View>
    </View>
  );
}
