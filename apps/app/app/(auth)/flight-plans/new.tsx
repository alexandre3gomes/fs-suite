import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Platform, View } from 'react-native';

import { VfrPlanForm, type VfrPlanData } from '../../../src/components/vfr/VfrPlanForm';
import { trackAction, trackSuccess, trackFailure, categorizeError, setFeatureContext } from '../../../src/services/analytics';
import { apiClient } from '../../../src/services/api.client';

export default function NewVfrPlanScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  useEffect(() => { setFeatureContext('vfr_planning', 'create'); return () => setFeatureContext(null); }, []);

  const handleSave = useCallback(async (data: VfrPlanData) => {
    setSaving(true);
    trackAction('flight_plan_save_requested', {
      plan_mode: 'create',
      flight_rules: data.flightRules,
      origin_icao: data.originIcao,
      destination_icao: data.destinationIcao,
      has_alternate: !!data.alternateIcao,
      has_route: (data.routeWaypoints?.length ?? 0) > 0,
      has_simbrief: !!data.simbriefOfpId,
      aircraft_type: data.aircraftType,
    });
    try {
      const created = await apiClient.post<{ id: string }>('/flight-plans', data);
      trackSuccess('flight_plan_created', {
        plan_id: created.id,
        flight_rules: data.flightRules,
        origin_icao: data.originIcao,
        destination_icao: data.destinationIcao,
        has_alternate: !!data.alternateIcao,
      });
      router.replace(`/(auth)/flight-plans/${created.id}`);
    } catch (err: unknown) {
      const { errorType, statusCode } = categorizeError(err);
      trackFailure('flight_plan_save_failed', errorType, { plan_mode: 'create', status_code: statusCode });
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
