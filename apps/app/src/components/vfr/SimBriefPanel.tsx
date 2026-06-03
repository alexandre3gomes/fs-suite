import { Input } from '@fs-suite/ui';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';
import { Dropdown } from 'react-native-element-dropdown';

import { notify } from '../../lib/notify';
import { trackAction, trackSuccess, trackFailure, categorizeError } from '../../services/analytics';
import { apiClient } from '../../services/api.client';

import { openExternal } from './dom-types';

const SIMBRIEF_DISPATCH_URL = 'https://dispatch.simbrief.com/options/custom';

interface SimBriefAircraft {
  icao: string;
  name: string;
}

export interface SimBriefOfpData {
  ofpId: string;
  originIcao: string;
  originName: string | null;
  originElevationFt: number | null;
  originRunway: string | null;
  destinationIcao: string;
  destinationName: string | null;
  destinationElevationFt: number | null;
  destinationRunway: string | null;
  alternateIcao: string | null;
  alternateName: string | null;
  alternateRunway: string | null;
  route: string | null;
  cruiseAltitudeFt: number | null;
  aircraftIcaoType: string | null;
  aircraftName: string | null;
  callsign: string | null;
  fuelPlanRampKg: number | null;
  fuelTaxiKg: number | null;
  fuelEnrouteKg: number | null;
  fuelContingencyKg: number | null;
  fuelAlternateKg: number | null;
  fuelReserveKg: number | null;
  fuelMinTakeoffKg: number | null;
  fuelAvgFlowKgH: number | null;
  flightTimeMinutes: number | null;
  todDistanceNm: number | null;
  sid: string | null;
  star: string | null;
  totalDistanceNm: number | null;
  ofpPdfUrl: string | null;
  ofpHtml: string | null;
}

function parseCallsign(cs: string): { airline: string; fltnum: string } | null {
  const match = cs.trim().match(/^([A-Za-z]{2,4})(\d+.*)$/);
  if (!match) return null;
  return { airline: match[1]!.toUpperCase(), fltnum: match[2]! };
}

interface Props {
  originIcao: string | null;
  destinationIcao: string | null;
  alternateIcao?: string | null;
  callsign: string;
  onCallsignChange: (v: string) => void;
  onImport: (data: SimBriefOfpData) => void;
}

export function SimBriefPanel({ originIcao, destinationIcao, alternateIcao, callsign, onCallsignChange, onImport }: Props) {
  const { t } = useTranslation();
  const router = useRouter();

  const [pilotId, setPilotId] = useState<string | null>(null);
  const [connectionLoading, setConnectionLoading] = useState(true);

  const [aircraftList, setAircraftList] = useState<SimBriefAircraft[]>([]);
  const [selectedAircraft, setSelectedAircraft] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    setConnectionLoading(true);
    apiClient
      .get<{ pilotId: string | null }>('/integrations/simbrief/connection')
      .then((data) => setPilotId(data.pilotId))
      .catch(() => {})
      .finally(() => setConnectionLoading(false));
  }, []);

  useEffect(() => {
    apiClient
      .get<SimBriefAircraft[]>('/integrations/simbrief/aircraft')
      .then(setAircraftList)
      .catch(() => {});
  }, []);

  const dropdownData = useMemo(
    () =>
      aircraftList.map((a) => ({
        label: `${a.icao} — ${a.name}`,
        value: a.icao,
        search: `${a.icao} ${a.name}`.toLowerCase(),
      })),
    [aircraftList],
  );

  const handleOpenDispatch = useCallback(() => {
    if (!originIcao || !destinationIcao) {
      notify(t('common.error'), t('vfr.simbriefNeedOriginDest'));
      return;
    }
    if (!pilotId) {
      notify(t('common.error'), t('vfr.simbriefNeedPilotId'));
      return;
    }
    trackAction('simbrief_dispatch_opened', {
      origin_icao: originIcao,
      destination_icao: destinationIcao,
      has_alternate: !!alternateIcao,
      has_aircraft: !!selectedAircraft,
      has_callsign: !!callsign,
    });

    const params = new URLSearchParams();
    params.set('orig', originIcao);
    params.set('dest', destinationIcao);
    if (alternateIcao) params.set('altn', alternateIcao);
    if (selectedAircraft) params.set('type', selectedAircraft);

    const parsed = parseCallsign(callsign);
    if (parsed) {
      params.set('airline', parsed.airline);
      params.set('fltnum', parsed.fltnum);
    }
    if (callsign) params.set('callsign', callsign);

    params.set('units', 'KGS');
    params.set('find_sidstar', '1');

    const url = `${SIMBRIEF_DISPATCH_URL}?${params.toString()}`;
    openExternal(url);
  }, [originIcao, destinationIcao, alternateIcao, selectedAircraft, callsign, pilotId, t]);

  const handleImportOfp = useCallback(async () => {
    if (!pilotId) {
      notify(t('common.error'), t('vfr.simbriefNeedPilotId'));
      return;
    }
    setImporting(true);
    trackAction('simbrief_import_requested');
    try {
      const data = await apiClient.get<SimBriefOfpData>('/integrations/simbrief/ofp');
      onImport(data);
      trackSuccess('simbrief_import_succeeded', {
        origin_icao: data.originIcao,
        destination_icao: data.destinationIcao,
        has_alternate: !!data.alternateIcao,
      });
      notify(t('vfr.simbrief'), t('vfr.simbriefImported'));
    } catch (err: unknown) {
      const { errorType, statusCode } = categorizeError(err);
      trackFailure('simbrief_import_failed', errorType, { status_code: statusCode });
      const message = err instanceof Error ? err.message : 'Could not import OFP.';
      notify(t('common.error'), message);
    }
    setImporting(false);
  }, [pilotId, onImport, t]);

  if (connectionLoading) {
    return (
      <View className="py-2">
        <Text className="text-xs text-muted-foreground">{t('common.loading')}</Text>
      </View>
    );
  }

  if (!pilotId) {
    return (
      <View className="rounded-md border border-border bg-surface-muted px-3 py-3">
        <Text className="mb-2 text-xs text-muted-foreground">
          {t('vfr.simbriefNeedPilotId')}
        </Text>
        <Pressable
          onPress={() => router.push('/(auth)/profile' as never)}
          className="rounded-button bg-primary px-4 py-2 active:opacity-80"
        >
          <Text className="text-center text-xs font-medium text-primary-foreground">
            {t('vfr.simbriefGoToProfile')}
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View>
      {/* Connected indicator */}
      <View className="mb-3 flex-row items-center gap-2">
        <View className="h-2 w-2 rounded-full bg-green-500" />
        <Text className="text-xs text-muted-foreground">
          {t('vfr.simbriefConnected')}: {pilotId}
        </Text>
      </View>

      {/* Callsign */}
      <View className="mb-3">
        <Input
          label={t('vfr.simbriefCallsign')}
          value={callsign}
          onChangeText={onCallsignChange}
          placeholder="BAW123"
        />
      </View>

      {/* Aircraft type selector */}
      <View className="mb-3">
        <Text className="mb-1 text-xs font-medium text-muted-foreground">
          {t('vfr.simbriefAircraft')}
        </Text>
        <Dropdown
          data={dropdownData}
          labelField="label"
          valueField="value"
          searchField="search"
          search
          searchPlaceholder={t('vfr.simbriefSearchAircraft')}
          placeholder={t('vfr.simbriefSearchAircraft')}
          value={selectedAircraft}
          onChange={(item) => setSelectedAircraft(item.value)}
          maxHeight={280}
          style={{
            borderWidth: 1,
            borderColor: 'rgba(128,128,128,0.3)',
            borderRadius: 8,
            paddingHorizontal: 12,
            paddingVertical: 10,
            backgroundColor: 'rgba(128,128,128,0.05)',
          }}
          placeholderStyle={{ color: 'rgba(128,128,128,0.5)', fontSize: 13 }}
          selectedTextStyle={{ color: '#e2e8f0', fontSize: 13 }}
          inputSearchStyle={{
            borderColor: 'rgba(128,128,128,0.3)',
            borderRadius: 6,
            color: '#e2e8f0',
            fontSize: 13,
          }}
          containerStyle={{
            backgroundColor: '#1e293b',
            borderColor: 'rgba(128,128,128,0.3)',
            borderRadius: 8,
          }}
          itemTextStyle={{ color: '#e2e8f0', fontSize: 13 }}
          activeColor="rgba(96,165,250,0.15)"
        />
      </View>

      {/* Action buttons */}
      <View className="flex-row gap-2">
        <Pressable
          onPress={handleOpenDispatch}
          disabled={!originIcao || !destinationIcao}
          className="flex-1 rounded-button border border-primary bg-primary/10 px-4 py-2.5 active:opacity-80 disabled:opacity-50"
        >
          <Text className="text-center text-xs font-semibold text-primary">
            {t('vfr.simbriefPlanWith')}
          </Text>
          <Text className="mt-0.5 text-center text-[9px] text-muted-foreground">
            {t('vfr.simbriefPlanHint')}
          </Text>
        </Pressable>
        <Pressable
          onPress={handleImportOfp}
          disabled={importing}
          className="flex-1 rounded-button border border-primary bg-primary px-4 py-2.5 active:opacity-80 disabled:opacity-50"
        >
          <Text className="text-center text-xs font-semibold text-primary-foreground">
            {importing ? t('vfr.simbriefImporting') : t('vfr.simbriefImport')}
          </Text>
          <Text className="mt-0.5 text-center text-[9px] text-primary-foreground/70">
            {t('vfr.simbriefImportHint')}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
