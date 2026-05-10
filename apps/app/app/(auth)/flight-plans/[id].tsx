import { Spinner } from '@fs-suite/ui';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, Text, View } from 'react-native';

import { VfrPlanForm, type VfrPlanData } from '../../../src/components/vfr/VfrPlanForm';
import { apiClient } from '../../../src/services/api.client';

export default function EditVfrPlanScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [plan, setPlan] = useState<VfrPlanData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!id) return;
    void (async () => {
      try {
        const data = await apiClient.get<VfrPlanData>(`/vfr-flight-plans/${id}`);
        setPlan(data);
      } catch {
        router.back();
      }
      setLoading(false);
    })();
  }, [id, router]);

  const handleSave = useCallback(async (data: VfrPlanData) => {
    setSaving(true);
    try {
      await apiClient.patch(`/vfr-flight-plans/${id}`, data);
      router.replace('/(auth)/flight-plans');
    } catch (err: unknown) {
      const e = err as Record<string, Record<string, Record<string, unknown>>>;
      const msg = e?.response?.data?.message ?? (err instanceof Error ? err.message : t('common.error'));
      Alert.alert(t('common.error'), Array.isArray(msg) ? msg.join('\n') : String(msg));
      setSaving(false);
    }
  }, [id, router, t]);

  const handleDelete = useCallback(() => {
    Alert.alert(t('vfr.deletePlan'), t('vfr.confirmDelete'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          try {
            await apiClient.delete(`/vfr-flight-plans/${id}`);
            router.replace('/(auth)/flight-plans');
          } catch { /* ignore */ }
        },
      },
    ]);
  }, [id, router, t]);

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <Spinner size="lg" />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-background">
      {/* Header */}
      <View className="flex-row items-center justify-between border-b border-border px-4 py-3 md:px-8">
        <Pressable onPress={() => router.back()}>
          <Text className="text-sm font-medium text-primary">{t('common.back')}</Text>
        </Pressable>
        <Text className="text-base font-bold text-foreground">{t('vfr.editPlan')}</Text>
        <Pressable onPress={handleDelete}>
          <Text className="text-sm font-medium text-destructive">{t('common.delete')}</Text>
        </Pressable>
      </View>

      {plan ? (
        <VfrPlanForm initialData={plan} onSave={handleSave} saving={saving} />
      ) : null}
    </View>
  );
}
