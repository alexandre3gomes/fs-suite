import { Card, CardContent, Spinner, Text } from '@fs-suite/ui';
import { Redirect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { useCurrentUser } from '../../../src/hooks/useCurrentUser';

export default function AdminScreen(): JSX.Element {
  const { t } = useTranslation();
  const router = useRouter();
  const { user, isLoading } = useCurrentUser();

  if (isLoading && !user) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <Spinner size="lg" />
      </View>
    );
  }
  // Gate: only admins (persisted flag with ADMIN_EMAILS bootstrap fallback).
  if (user && !user.isAdmin) {
    return <Redirect href="/(auth)/dashboard" />;
  }

  return (
    <View className="flex-1 bg-background">
      <View className="flex-1 px-4 py-6 md:mx-auto md:w-full md:max-w-3xl md:px-8 md:py-10">
        <Text variant="h3" className="mb-6">
          {t('admin.title')}
        </Text>

        <Card className="active:opacity-80">
          <Pressable onPress={() => router.push('/(auth)/admin/users')}>
            <CardContent className="md:px-8 md:py-6">
              <Text className="text-base font-bold md:text-lg">{t('admin.usersCard')}</Text>
              <Text variant="muted" className="mt-1">{t('admin.usersCardDesc')}</Text>
            </CardContent>
          </Pressable>
        </Card>
      </View>
    </View>
  );
}
