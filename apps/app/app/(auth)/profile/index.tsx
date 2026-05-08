import { Input } from '@fs-suite/ui';
import { Stack } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';

import { useCurrentUser } from '../../../src/hooks/useCurrentUser';
import { apiClient } from '../../../src/services/api.client';

export default function ProfileScreen() {
  const { t } = useTranslation();
  const { user } = useCurrentUser();

  // SimBrief connection
  const [simbriefPilotId, setSimbriefPilotId] = useState('');
  const [simbriefLoading, setSimbriefLoading] = useState(true);
  const [simbriefSaving, setSimbriefSaving] = useState(false);
  const [simbriefSaved, setSimbriefSaved] = useState(false);

  useEffect(() => {
    setSimbriefLoading(true);
    apiClient
      .get<{ pilotId: string | null }>('/integrations/simbrief/connection')
      .then((data) => {
        if (data.pilotId) setSimbriefPilotId(data.pilotId);
      })
      .catch(() => {})
      .finally(() => setSimbriefLoading(false));
  }, []);

  const handleSaveSimbrief = useCallback(async () => {
    const id = simbriefPilotId.trim();
    if (!id) return;
    setSimbriefSaving(true);
    try {
      await apiClient.patch('/integrations/simbrief/connection', { pilotId: id });
      setSimbriefSaved(true);
      setTimeout(() => setSimbriefSaved(false), 2000);
    } catch {
      Alert.alert(t('common.error'), 'Could not save SimBrief pilot ID.');
    }
    setSimbriefSaving(false);
  }, [simbriefPilotId, t]);

  return (
    <>
      <Stack.Screen options={{ title: t('dashboard.profile'), headerShown: true, headerBackTitle: t('common.back') }} />
      <ScrollView className="flex-1 bg-background" contentContainerStyle={{ paddingBottom: 40 }}>
        <View className="md:mx-auto md:w-full md:max-w-2xl">
          {/* User info */}
          <View className="border-b border-border px-4 py-5 md:px-6">
            <Text className="text-base font-bold text-foreground">{t('dashboard.profile')}</Text>
            {user ? (
              <View className="mt-3">
                <Text className="text-sm text-foreground">{user.name}</Text>
                <Text className="text-xs text-muted-foreground">{user.email}</Text>
              </View>
            ) : null}
          </View>

          {/* Integrations */}
          <View className="border-b border-border px-4 py-5 md:px-6">
            <Text className="mb-3 text-base font-bold text-foreground">
              {t('profile.integrations')}
            </Text>

            {/* SimBrief */}
            <View className="rounded-md border border-border bg-surface-muted px-4 py-4">
              <View className="mb-2 flex-row items-center gap-2">
                <Text className="text-sm font-semibold text-foreground">SimBrief</Text>
                {!simbriefLoading && simbriefPilotId ? (
                  <View className="flex-row items-center gap-1">
                    <View className="h-2 w-2 rounded-full bg-green-500" />
                    <Text className="text-[10px] text-green-600">{t('vfr.simbriefConnected')}</Text>
                  </View>
                ) : null}
              </View>
              <Text className="mb-3 text-xs text-muted-foreground">
                {t('profile.simbriefDescription')}
              </Text>
              {simbriefLoading ? (
                <Text className="text-xs text-muted-foreground">{t('common.loading')}</Text>
              ) : (
                <View className="flex-row items-end gap-2">
                  <View className="flex-1">
                    <Input
                      label={t('vfr.simbriefPilotId')}
                      value={simbriefPilotId}
                      onChangeText={(v) => { setSimbriefPilotId(v); setSimbriefSaved(false); }}
                      placeholder={t('vfr.simbriefPilotIdPlaceholder')}
                    />
                  </View>
                  <Pressable
                    onPress={handleSaveSimbrief}
                    disabled={simbriefSaving || !simbriefPilotId.trim()}
                    className="rounded-button bg-primary px-4 py-2.5 active:opacity-80 disabled:opacity-50"
                  >
                    <Text className="text-xs font-medium text-primary-foreground">
                      {simbriefSaving ? t('common.saving') : simbriefSaved ? '✓' : t('common.save')}
                    </Text>
                  </Pressable>
                </View>
              )}
            </View>
          </View>
        </View>
      </ScrollView>
    </>
  );
}
