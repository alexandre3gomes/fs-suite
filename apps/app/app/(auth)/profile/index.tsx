import { Avatar, Button, Input, Spinner } from '@fs-suite/ui';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';

import { useCurrentUser } from '../../../src/hooks/useCurrentUser';
import { apiClient } from '../../../src/services/api.client';
import { signOut } from '../../../src/services/auth.service';

export default function ProfileScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { user, isLoading } = useCurrentUser();

  const [pilotId, setPilotId] = useState('');
  const [pilotIdSaved, setPilotIdSaved] = useState('');
  const [savingPilotId, setSavingPilotId] = useState(false);

  const loadSimBriefConnection = useCallback(async () => {
    try {
      const conn = await apiClient.get<{ pilotId: string | null }>('/integrations/simbrief/connection');
      if (conn.pilotId) {
        setPilotId(conn.pilotId);
        setPilotIdSaved(conn.pilotId);
      }
    } catch {
      // ignore — user may not have a connection yet
    }
  }, []);

  useEffect(() => {
    void loadSimBriefConnection();
  }, [loadSimBriefConnection]);

  const handleSavePilotId = async () => {
    if (!pilotId.trim()) return;
    setSavingPilotId(true);
    try {
      await apiClient.patch('/integrations/simbrief/connection', { pilotId: pilotId.trim() });
      setPilotIdSaved(pilotId.trim());
      Alert.alert(t('common.save'), t('profile.simbriefSaved'));
    } catch (err) {
      Alert.alert(t('common.error'), err instanceof Error ? err.message : t('common.error'));
    } finally {
      setSavingPilotId(false);
    }
  };

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
        <View className="mb-6 overflow-hidden rounded-card border border-border bg-surface">
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

        {/* SimBrief Pilot ID */}
        <View className="mb-8 overflow-hidden rounded-card border border-border bg-surface p-4">
          <Text className="mb-3 text-base font-semibold text-foreground">
            {t('profile.simbriefSection')}
          </Text>
          <Text className="mb-2 text-xs text-muted-foreground">
            {t('profile.simbriefPilotId')}
          </Text>
          <View className="flex-row gap-2">
            <View className="flex-1">
              <Input
                value={pilotId}
                onChangeText={setPilotId}
                placeholder={t('profile.simbriefPlaceholder')}
              />
            </View>
            <Button
              onPress={() => { void handleSavePilotId(); }}
              disabled={savingPilotId || pilotId.trim() === pilotIdSaved}
              variant="primary"
            >
              {savingPilotId ? t('common.loading') : t('common.save')}
            </Button>
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
