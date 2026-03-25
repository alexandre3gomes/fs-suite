import { Avatar, Spinner } from '@fs-suite/ui';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { useCurrentUser } from '../../../src/hooks/useCurrentUser';
import { signOut } from '../../../src/services/auth.service';

export default function ProfileScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { user, isLoading } = useCurrentUser();

  const handleSignOut = async (): Promise<void> => {
    await signOut();
    router.replace('/(public)/login');
  };

  if (isLoading && !user) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <Spinner size="lg" />
      </View>
    );
  }

  return (
    <ScrollView className="flex-1 bg-background">
      <View className="px-4 py-6">
        <Text className="mb-6 text-2xl font-bold text-foreground">{t('profile.title')}</Text>

        {/* Avatar + name header */}
        <View className="mb-6 items-center gap-3">
          <Avatar uri={user?.avatarUrl} name={user?.name} size={80} />
          {user?.name ? (
            <Text className="text-lg font-semibold text-foreground">{user.name}</Text>
          ) : null}
        </View>

        {/* Info rows */}
        <View className="mb-8 overflow-hidden rounded-card border border-border bg-surface">
          <View className="border-b border-border px-4 py-3">
            <Text className="mb-0.5 text-xs uppercase tracking-wide text-muted-foreground">
              {t('profile.name')}
            </Text>
            <Text className="text-foreground">{user?.name ?? '—'}</Text>
          </View>

          <View className="px-4 py-3">
            <Text className="mb-0.5 text-xs uppercase tracking-wide text-muted-foreground">
              {t('profile.email')}
            </Text>
            <Text className="font-mono text-foreground">{user?.email ?? '—'}</Text>
          </View>
        </View>

        {/* Sign out */}
        <Pressable
          className="rounded-button border border-destructive px-6 py-3 active:opacity-70"
          onPress={() => {
            void handleSignOut();
          }}
        >
          <Text className="text-center font-medium text-destructive">{t('profile.signOut')}</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}
