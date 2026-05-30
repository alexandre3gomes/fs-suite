import { Spinner } from '@fs-suite/ui';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Animated, Platform, Text, View } from 'react-native';

import { VfrPlanForm, type VfrPlanData } from '../../../src/components/vfr/VfrPlanForm';
import { trackAction, trackSuccess, trackFailure, categorizeError, setFeatureContext } from '../../../src/services/analytics';
import { apiClient } from '../../../src/services/api.client';

function SaveToast({ visible, message }: { visible: boolean; message: string }) {
  const slideAnim = useRef(new Animated.Value(300)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(slideAnim, { toValue: 0, duration: 300, useNativeDriver: true }),
        Animated.timing(opacityAnim, { toValue: 1, duration: 300, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(slideAnim, { toValue: 300, duration: 250, useNativeDriver: true }),
        Animated.timing(opacityAnim, { toValue: 0, duration: 250, useNativeDriver: true }),
      ]).start();
    }
  }, [visible, slideAnim, opacityAnim]);

  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        bottom: 32,
        right: 80,
        transform: [{ translateX: slideAnim }],
        opacity: opacityAnim,
        zIndex: 9999,
      }}
    >
      <View className="flex-row items-center gap-2 rounded-lg bg-green-600 px-4 py-3 shadow-lg">
        <Text className="text-sm font-semibold text-white">{message}</Text>
      </View>
    </Animated.View>
  );
}

export default function EditVfrPlanScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [plan, setPlan] = useState<VfrPlanData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showToast, setShowToast] = useState(false);

  useEffect(() => {
    if (!id) return;
    void (async () => {
      try {
        const data = await apiClient.get<VfrPlanData & { routes?: { sequence: number; waypointIdent: string; latitude: number | null; longitude: number | null; role?: 'MAIN' | 'ALTERNATE' }[] }>(`/flight-plans/${id}`);
        if (data.routes) {
          const routesTyped = data.routes as { sequence: number; waypointIdent: string; latitude: number | null; longitude: number | null; role?: 'MAIN' | 'ALTERNATE' }[];
          const mainRoutes = routesTyped.filter((r) => (r.role ?? 'MAIN') === 'MAIN');
          const altRoutes = routesTyped.filter((r) => r.role === 'ALTERNATE');
          if (!data.routeWaypoints) {
            data.routeWaypoints = mainRoutes
              .sort((a, b) => a.sequence - b.sequence)
              .filter((r) => r.latitude != null && r.longitude != null)
              .map((r) => ({ lat: r.latitude!, lng: r.longitude!, name: r.waypointIdent }));
          }
          if (!data.alternateRouteWaypoints) {
            data.alternateRouteWaypoints = altRoutes
              .sort((a, b) => a.sequence - b.sequence)
              .filter((r) => r.latitude != null && r.longitude != null)
              .map((r) => ({ lat: r.latitude!, lng: r.longitude!, name: r.waypointIdent }));
          }
        }
        const icaos = [data.originIcao, data.destinationIcao, data.alternateIcao].filter(Boolean) as string[];
        const aerodromes = await Promise.all(
          icaos.map((icao) => apiClient.get<{ icao: string; latitude: number; longitude: number }>(`/aerodromes/${icao}`).catch(() => null)),
        );
        const coordMap = new Map<string, { lat: number; lng: number }>();
        for (const a of aerodromes) {
          if (a) coordMap.set(a.icao, { lat: a.latitude, lng: a.longitude });
        }
        const orig = coordMap.get(data.originIcao);
        if (orig) { data.originLatitude = orig.lat; data.originLongitude = orig.lng; }
        const dest = coordMap.get(data.destinationIcao);
        if (dest) { data.destinationLatitude = dest.lat; data.destinationLongitude = dest.lng; }
        if (data.alternateIcao) {
          const alt = coordMap.get(data.alternateIcao);
          if (alt) { data.alternateLatitude = alt.lat; data.alternateLongitude = alt.lng; }
        }
        setPlan(data);
      } catch {
        router.back();
      }
      setLoading(false);
    })();
  }, [id, router]);

  useEffect(() => { setFeatureContext('vfr_planning', 'edit'); return () => setFeatureContext(null); }, []);

  const handleSave = useCallback(async (data: VfrPlanData) => {
    setSaving(true);
    trackAction('flight_plan_save_requested', {
      plan_mode: 'edit',
      plan_id: id,
      flight_rules: data.flightRules,
      origin_icao: data.originIcao,
      destination_icao: data.destinationIcao,
      has_alternate: !!data.alternateIcao,
      has_route: (data.routeWaypoints?.length ?? 0) > 0,
      has_simbrief: !!data.simbriefOfpId,
      aircraft_type: data.aircraftType,
    });
    try {
      await apiClient.patch(`/flight-plans/${id}`, data);
      trackSuccess('flight_plan_updated', { plan_id: id, flight_rules: data.flightRules });
      setSaving(false);
      setShowToast(true);
      setTimeout(() => setShowToast(false), 3000);
    } catch (err: unknown) {
      const { errorType, statusCode } = categorizeError(err);
      trackFailure('flight_plan_save_failed', errorType, { plan_mode: 'edit', plan_id: id, status_code: statusCode });
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
  }, [id, t]);

  const handleDelete = useCallback(() => {
    const doDelete = async () => {
      trackAction('flight_plan_delete_requested', { plan_id: id });
      try {
        await apiClient.delete(`/flight-plans/${id}`);
        trackSuccess('flight_plan_deleted', { plan_id: id });
        router.replace('/(auth)/flight-plans');
      } catch (err) {
        const { errorType, statusCode } = categorizeError(err);
        trackFailure('flight_plan_delete_failed', errorType, { plan_id: id, status_code: statusCode });
      }
    };

    if (Platform.OS === 'web') {
      const win = globalThis as unknown as { confirm: (msg: string) => boolean };
      if (win.confirm(t('vfr.confirmDelete'))) void doDelete();
    } else {
      Alert.alert(t('vfr.deletePlan'), t('vfr.confirmDelete'), [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('common.delete'), style: 'destructive', onPress: () => void doDelete() },
      ]);
    }
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
      {plan ? (
        <VfrPlanForm
          initialData={plan}
          onSave={handleSave}
          saving={saving}
          onDelete={handleDelete}
        />
      ) : null}

      <SaveToast visible={showToast} message={t('vfr.planSaved')} />
    </View>
  );
}
