import { Badge, Card, Spinner } from '@fs-suite/ui';
import { router, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Linking, Platform, Pressable, ScrollView, Text, View } from 'react-native';

import { apiClient } from '../../../../src/services/api.client';

interface Route {
  id: string;
  sequence: number;
  waypointIdent: string;
  latitude: number | null;
  longitude: number | null;
  airway: string | null;
}

interface FlightPlanDetail {
  id: string;
  status: string;
  flightType: string;
  originIcao: string;
  destinationIcao: string;
  plannedAltitude: number | null;
  remarks: string | null;
  simBriefOfpId: string | null;
  createdAt: string;
  updatedAt: string;
  origin: { icao: string; name: string; city: string | null; country: string | null };
  destination: { icao: string; name: string; city: string | null; country: string | null };
  aircraftProfile: { id: string; name: string; icaoType: string | null } | null;
  routes: Route[];
}

export default function FlightPlanDetailScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [plan, setPlan] = useState<FlightPlanDetail | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchPlan = useCallback(async () => {
    setLoading(true);
    try {
      const result = await apiClient.get<FlightPlanDetail>(`/flight-plans/${id}`);
      setPlan(result);
    } catch {
      Alert.alert(t('common.error'), t('flightPlans.detail.loadError'));
    } finally {
      setLoading(false);
    }
  }, [id, t]);

  useEffect(() => {
    void fetchPlan();
  }, [fetchPlan]);

  const handleImportSimBrief = async () => {
    try {
      const ofp = await apiClient.get<{
        ofpId: string;
        originIcao: string;
        destinationIcao: string;
        route: string | null;
        aircraftIcaoType: string | null;
        fuelPlanned: number | null;
      }>('/integrations/simbrief/ofp');

      // Build update payload from OFP data
      const updatePayload: Record<string, unknown> = {
        simBriefOfpId: ofp.ofpId,
      };

      if (ofp.originIcao) updatePayload.originIcao = ofp.originIcao;
      if (ofp.destinationIcao) updatePayload.destinationIcao = ofp.destinationIcao;

      // Parse route string into waypoints
      if (ofp.route) {
        const waypoints = ofp.route
          .split(/\s+/)
          .map((w) => w.trim().toUpperCase())
          .filter((w) => w.length > 0);
        updatePayload.routes = waypoints.map((wpt, idx) => ({
          sequence: idx,
          waypointIdent: wpt,
        }));
      }

      // Apply OFP data to the flight plan
      await apiClient.patch(`/flight-plans/${id}`, updatePayload);

      // Refresh plan data to reflect changes
      await fetchPlan();

      Alert.alert(
        t('flightPlans.detail.simbriefImported'),
        `${ofp.originIcao} → ${ofp.destinationIcao}${ofp.route ? `\n${ofp.route}` : ''}`,
      );
    } catch (err) {
      Alert.alert(t('common.error'), err instanceof Error ? err.message : t('common.error'));
    }
  };

  const handleOpenSkyVector = async () => {
    if (!plan) return;
    try {
      const routeStr = plan.routes.map((r) => r.waypointIdent).join(' ');
      const params = new URLSearchParams({
        originIcao: plan.originIcao,
        destinationIcao: plan.destinationIcao,
      });
      if (routeStr) params.set('route', routeStr);

      const result = await apiClient.get<{ url: string }>(
        `/integrations/skyvector/url?${params.toString()}`,
      );

      if (Platform.OS === 'web') {
        await Linking.openURL(result.url);
      } else {
        await WebBrowser.openBrowserAsync(result.url);
      }
    } catch (err) {
      Alert.alert(t('common.error'), err instanceof Error ? err.message : t('common.error'));
    }
  };

  const handleDuplicate = async () => {
    try {
      const newPlan = await apiClient.post<{ id: string }>(`/flight-plans/${id}/duplicate`);
      router.replace(`/(auth)/flight-plans/${newPlan.id}` as never);
    } catch (err) {
      Alert.alert(t('common.error'), err instanceof Error ? err.message : t('common.error'));
    }
  };

  const handleDelete = () => {
    Alert.alert(t('flightPlans.delete'), t('flightPlans.detail.deleteConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('flightPlans.delete'),
        style: 'destructive',
        onPress: async () => {
          try {
            await apiClient.delete(`/flight-plans/${id}`);
            router.back();
          } catch (err) {
            Alert.alert(t('common.error'), err instanceof Error ? err.message : t('common.error'));
          }
        },
      },
    ]);
  };

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <Spinner size="lg" />
      </View>
    );
  }

  if (!plan) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <Text className="text-muted-foreground">{t('flightPlans.detail.notFound')}</Text>
      </View>
    );
  }

  return (
    <ScrollView className="flex-1 bg-background">
      <View className="px-4 py-6">
        {/* Header */}
        <View className="mb-6 flex-row items-center gap-3">
          <Pressable onPress={() => router.back()}>
            <Text className="text-primary">{t('common.back')}</Text>
          </Pressable>
          <Text className="flex-1 text-2xl font-bold text-foreground">
            {plan.originIcao} → {plan.destinationIcao}
          </Text>
          <Badge variant={plan.status === 'SAVED' ? 'success' : 'outline'}>{plan.status}</Badge>
        </View>

        {/* Info card */}
        <Card className="mb-4 p-4">
          <View className="gap-3">
            <InfoRow label={t('flightPlans.flightType')} value={plan.flightType} />
            <InfoRow
              label={t('flightPlans.origin')}
              value={`${plan.origin.icao} — ${plan.origin.name}${plan.origin.city ? ` (${plan.origin.city})` : ''}`}
            />
            <InfoRow
              label={t('flightPlans.destination')}
              value={`${plan.destination.icao} — ${plan.destination.name}${plan.destination.city ? ` (${plan.destination.city})` : ''}`}
            />
            {plan.aircraftProfile ? (
              <InfoRow
                label={t('flightPlans.aircraft')}
                value={
                  plan.aircraftProfile.icaoType
                    ? `${plan.aircraftProfile.name} (${plan.aircraftProfile.icaoType})`
                    : plan.aircraftProfile.name
                }
              />
            ) : null}
            {plan.plannedAltitude ? (
              <InfoRow label={t('flightPlans.form.altitude')} value={`FL${Math.round(plan.plannedAltitude / 100)}`} />
            ) : null}
            {plan.remarks ? <InfoRow label={t('flightPlans.form.remarks')} value={plan.remarks} /> : null}
            <InfoRow
              label={t('flightPlans.detail.created')}
              value={new Date(plan.createdAt).toLocaleString()}
            />
          </View>
        </Card>

        {/* Route */}
        {plan.routes.length > 0 ? (
          <Card className="mb-4 p-4">
            <Text className="mb-3 text-base font-semibold text-foreground">{t('flightPlans.route')}</Text>
            <View className="gap-2">
              {plan.routes.map((r) => (
                <View key={r.id} className="flex-row items-center gap-2">
                  <Text className="w-8 text-right text-xs text-muted-foreground">{r.sequence}</Text>
                  <Text className="font-mono text-foreground">{r.waypointIdent}</Text>
                  {r.airway ? (
                    <Text className="text-xs text-muted-foreground">via {r.airway}</Text>
                  ) : null}
                </View>
              ))}
            </View>
          </Card>
        ) : null}

        {/* Integration actions */}
        <Card className="mb-4 p-4">
          <Text className="mb-3 text-base font-semibold text-foreground">
            {t('flightPlans.detail.integrations')}
          </Text>
          <View className="gap-2">
            <Pressable
              className="flex-row items-center rounded-button border border-accent px-4 py-3"
              onPress={() => { void handleImportSimBrief(); }}
            >
              <Text className="flex-1 font-medium text-accent">
                {t('flightPlans.detail.importSimbrief')}
              </Text>
            </Pressable>
            <Pressable
              className="flex-row items-center rounded-button border border-primary px-4 py-3"
              onPress={() => { void handleOpenSkyVector(); }}
            >
              <Text className="flex-1 font-medium text-primary">
                {t('flightPlans.detail.openSkyvector')}
              </Text>
            </Pressable>
          </View>
        </Card>

        {/* Actions */}
        <View className="flex-row gap-3">
          <Pressable
            className="flex-1 rounded-button border border-primary px-4 py-3"
            onPress={() => { void handleDuplicate(); }}
          >
            <Text className="text-center font-medium text-primary">{t('flightPlans.duplicate')}</Text>
          </Pressable>
          <Pressable
            className="flex-1 rounded-button border border-destructive px-4 py-3"
            onPress={handleDelete}
          >
            <Text className="text-center font-medium text-destructive">{t('flightPlans.delete')}</Text>
          </Pressable>
        </View>
      </View>
    </ScrollView>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View>
      <Text className="text-xs uppercase tracking-wide text-muted-foreground">{label}</Text>
      <Text className="text-foreground">{value}</Text>
    </View>
  );
}
