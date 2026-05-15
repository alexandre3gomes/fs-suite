import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Platform, View } from 'react-native';

import { VfrPlanForm, type VfrPlanData } from '../../../src/components/vfr/VfrPlanForm';
import { apiClient } from '../../../src/services/api.client';

export default function NewVfrPlanScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  const handleSave = useCallback(async (data: VfrPlanData) => {
    setSaving(true);
    try {
      const created = await apiClient.post<{ id: string }>('/flight-plans', data);
      router.replace(`/(auth)/flight-plans/${created.id}`);
    } catch (err: unknown) {
      const e = err as Record<string, Record<string, Record<string, unknown>>>;
      const msg = e?.response?.data?.message ?? (err instanceof Error ? err.message : t('common.error'));
      const text = Array.isArray(msg) ? msg.join('\n') : String(msg);
      if (Platform.OS === 'web') {
        (globalThis as unknown as { alert: (m: string) => void }).alert(`${t('common.error')}: ${text}`);
      } else {
        Alert.alert(t('common.error'), text);
      }
      setSaving(false);
    }
  }, [router, t]);

  return (
    <View className="flex-1 bg-background">
      <VfrPlanForm onSave={handleSave} saving={saving} />
    </View>
  );
}
