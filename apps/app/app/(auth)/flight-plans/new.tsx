import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, Text, View } from 'react-native';

import { VfrPlanForm, type VfrPlanData } from '../../../src/components/vfr/VfrPlanForm';
import { apiClient } from '../../../src/services/api.client';

export default function NewVfrPlanScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  const handleSave = useCallback(async (data: VfrPlanData) => {
    setSaving(true);
    try {
      await apiClient.post('/vfr-flight-plans', data);
      router.replace('/(auth)/flight-plans');
    } catch (err: any) {
      const msg = err?.response?.data?.message ?? err?.message ?? t('common.error');
      Alert.alert(t('common.error'), Array.isArray(msg) ? msg.join('\n') : String(msg));
      setSaving(false);
    }
  }, [router, t]);

  return (
    <View className="flex-1 bg-background">
      {/* Header */}
      <View className="flex-row items-center justify-between border-b border-border px-4 py-3 md:px-8">
        <Pressable onPress={() => router.back()}>
          <Text className="text-sm font-medium text-primary">{t('common.back')}</Text>
        </Pressable>
        <Text className="text-base font-bold text-foreground">{t('dashboard.newPlan')}</Text>
        <View style={{ width: 50 }} />
      </View>

      <VfrPlanForm onSave={handleSave} saving={saving} />
    </View>
  );
}
