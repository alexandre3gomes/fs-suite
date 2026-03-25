import { Button, Combobox, Input, Select } from '@fs-suite/ui';
import type { ComboboxOption } from '@fs-suite/ui';
import { router } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';

import { apiClient } from '../../../../src/services/api.client';

interface AircraftProfile {
  id: string;
  name: string;
  icaoType: string | null;
}

interface SimBriefOfp {
  ofpId: string;
  originIcao: string;
  destinationIcao: string;
  route: string | null;
  aircraftIcaoType: string | null;
  fuelPlanned: number | null;
}

const FLIGHT_TYPE_OPTIONS = [
  { label: 'VFR', value: 'VFR' },
  { label: 'IFR', value: 'IFR' },
];

export default function NewFlightPlanScreen() {
  const { t } = useTranslation();

  const [flightType, setFlightType] = useState('VFR');
  const [originIcao, setOriginIcao] = useState('');
  const [destinationIcao, setDestinationIcao] = useState('');
  const [aircraftProfileId, setAircraftProfileId] = useState('');
  const [plannedAltitude, setPlannedAltitude] = useState('');
  const [remarks, setRemarks] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [importingSimbrief, setImportingSimbrief] = useState(false);

  // Airport search
  const [originOptions, setOriginOptions] = useState<ComboboxOption[]>([]);
  const [destOptions, setDestOptions] = useState<ComboboxOption[]>([]);

  // Aircraft profiles
  const [aircraftOptions, setAircraftOptions] = useState<{ label: string; value: string }[]>([]);
  const [aircraftLoaded, setAircraftLoaded] = useState(false);

  const searchAirports = useCallback(async (query: string, setter: (opts: ComboboxOption[]) => void) => {
    if (query.length < 2) {
      setter([]);
      return;
    }
    try {
      const results = await apiClient.get<{ icao: string; name: string; city: string | null }[]>(
        `/airports?q=${encodeURIComponent(query)}`,
      );
      setter(
        results.map((a) => ({
          label: `${a.icao} — ${a.name}${a.city ? ` (${a.city})` : ''}`,
          value: a.icao,
        })),
      );
    } catch {
      setter([]);
    }
  }, []);

  const loadAircraftProfiles = useCallback(async () => {
    if (aircraftLoaded) return;
    try {
      const profiles = await apiClient.get<AircraftProfile[]>('/aircraft-profiles');
      setAircraftOptions(
        profiles.map((p) => ({
          label: p.icaoType ? `${p.name} (${p.icaoType})` : p.name,
          value: p.id,
        })),
      );
      setAircraftLoaded(true);
    } catch {
      // ignore
    }
  }, [aircraftLoaded]);

  const handleImportSimBrief = async () => {
    setImportingSimbrief(true);
    try {
      const ofp = await apiClient.get<SimBriefOfp>('/integrations/simbrief/ofp');

      // Apply OFP data to form fields
      if (ofp.originIcao) {
        setOriginIcao(ofp.originIcao);
        setOriginOptions([{ label: ofp.originIcao, value: ofp.originIcao }]);
      }
      if (ofp.destinationIcao) {
        setDestinationIcao(ofp.destinationIcao);
        setDestOptions([{ label: ofp.destinationIcao, value: ofp.destinationIcao }]);
      }
      if (ofp.route) {
        setRemarks((prev) => prev ? `${prev}\n${t('flightPlans.route')}: ${ofp.route}` : `${t('flightPlans.route')}: ${ofp.route}`);
      }

      // SimBrief flights are typically IFR
      setFlightType('IFR');

      Alert.alert(
        t('flightPlans.detail.simbriefImported'),
        `${ofp.originIcao} → ${ofp.destinationIcao}${ofp.route ? `\n${ofp.route}` : ''}`,
      );
    } catch (err) {
      Alert.alert(t('common.error'), err instanceof Error ? err.message : t('common.error'));
    } finally {
      setImportingSimbrief(false);
    }
  };

  const handleSubmit = async () => {
    if (!originIcao || !destinationIcao) {
      Alert.alert(t('common.error'), t('flightPlans.form.missingAirports'));
      return;
    }

    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        flightType,
        originIcao: originIcao.toUpperCase(),
        destinationIcao: destinationIcao.toUpperCase(),
      };
      if (plannedAltitude) body.plannedAltitude = parseInt(plannedAltitude, 10);
      if (remarks) body.remarks = remarks;
      if (aircraftProfileId) body.aircraftProfileId = aircraftProfileId;

      const plan = await apiClient.post<{ id: string }>('/flight-plans', body);
      router.replace(`/(auth)/flight-plans/${plan.id}` as never);
    } catch (err) {
      Alert.alert(t('common.error'), err instanceof Error ? err.message : t('common.error'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ScrollView className="flex-1 bg-background" keyboardShouldPersistTaps="handled">
      <View className="px-4 py-6">
        {/* Header */}
        <View className="mb-6 flex-row items-center gap-3">
          <Pressable onPress={() => router.back()}>
            <Text className="text-primary">{t('common.back')}</Text>
          </Pressable>
          <Text className="text-2xl font-bold text-foreground">{t('flightPlans.newPlan')}</Text>
        </View>

        <View className="gap-5">
          {/* Flight type */}
          <View>
            <Text className="mb-1.5 text-sm font-medium text-muted-foreground">
              {t('flightPlans.flightType')}
            </Text>
            <Select
              options={FLIGHT_TYPE_OPTIONS}
              value={flightType}
              onValueChange={setFlightType}
            />
          </View>

          {/* Origin */}
          <View>
            <Text className="mb-1.5 text-sm font-medium text-muted-foreground">
              {t('flightPlans.origin')}
            </Text>
            <Combobox
              options={originOptions}
              value={originIcao}
              onValueChange={setOriginIcao}
              onSearch={(q) => { void searchAirports(q, setOriginOptions); }}
              placeholder={t('flightPlans.form.searchAirport')}
            />
          </View>

          {/* Destination */}
          <View>
            <Text className="mb-1.5 text-sm font-medium text-muted-foreground">
              {t('flightPlans.destination')}
            </Text>
            <Combobox
              options={destOptions}
              value={destinationIcao}
              onValueChange={setDestinationIcao}
              onSearch={(q) => { void searchAirports(q, setDestOptions); }}
              placeholder={t('flightPlans.form.searchAirport')}
            />
          </View>

          {/* Aircraft profile */}
          <View>
            <Text className="mb-1.5 text-sm font-medium text-muted-foreground">
              {t('flightPlans.aircraft')}
            </Text>
            <Select
              options={aircraftOptions}
              value={aircraftProfileId}
              onValueChange={setAircraftProfileId}
              placeholder={t('flightPlans.form.selectAircraft')}
              onLayout={() => { void loadAircraftProfiles(); }}
            />
          </View>

          {/* Altitude */}
          <View>
            <Text className="mb-1.5 text-sm font-medium text-muted-foreground">
              {t('flightPlans.form.altitude')}
            </Text>
            <Input
              value={plannedAltitude}
              onChangeText={setPlannedAltitude}
              placeholder={t('flightPlans.form.altitudePlaceholder')}
              keyboardType="numeric"
            />
          </View>

          {/* Remarks */}
          <View>
            <Text className="mb-1.5 text-sm font-medium text-muted-foreground">
              {t('flightPlans.form.remarks')}
            </Text>
            <Input
              value={remarks}
              onChangeText={setRemarks}
              placeholder={t('flightPlans.form.remarksPlaceholder')}
              multiline
              numberOfLines={3}
            />
          </View>

          {/* Import from SimBrief */}
          <Pressable
            className="flex-row items-center rounded-button border border-accent px-4 py-3"
            onPress={() => { void handleImportSimBrief(); }}
            disabled={importingSimbrief}
          >
            <Text className="flex-1 text-center font-medium text-accent">
              {importingSimbrief ? t('common.loading') : t('flightPlans.detail.importSimbrief')}
            </Text>
          </Pressable>

          {/* Submit */}
          <Button
            onPress={() => { void handleSubmit(); }}
            disabled={submitting}
          >
            {submitting ? t('common.loading') : t('flightPlans.save')}
          </Button>
        </View>
      </View>
    </ScrollView>
  );
}
