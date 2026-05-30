import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';

import { apiClient } from '../../services/api.client';

import { type RouteWaypoint } from './vfrNavigation';

// Detection shape returned by /rea/detect — still used by the parent for the
// map overlay and charts panel, so it stays exported here.
export interface ReaDetectionRegion {
  regionId: string;
  chartName: string;
  chartPdfUrl: string;
  hasMandatory: boolean;
  corridors: {
    name: string;
    tipo: 'Obrig' | 'Recom';
    segments: {
      nome: string;
      tipo: 'Obrig' | 'Recom';
      trecho: number;
      fixoA: { lat: number; lon: number; nome: string };
      fixoB: { lat: number; lon: number; nome: string };
      rumoAtoB: number | null;
      rumoBtoA: number | null;
      altMinAtoB: number;
      altMaxAtoB: number;
      altMinBtoA: number;
      altMaxBtoA: number;
      altComp: number | null;
      altCompAtoB: number | null;
      altCompBtoA: number | null;
      fca: string;
      ats: string;
      geometry: { type: string; coordinates: number[][][][] | number[][][] };
    }[];
  }[];
}

export interface ReaViolation {
  from: string;
  to: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface ReaEndpoint {
  latitude: number;
  longitude: number;
}

export interface ReaCorridorApplyData {
  waypoints: RouteWaypoint[];
  corridorName: string;
  altRange: { min: number; max: number } | null;
  compAlt: number | null;
}

// One enumerated (entry gate → exit gate) route option from
// GET /rea/navigate/options. The backend already deduplicates by gate pair,
// filters for direction efficiency, and sorts by distance — the frontend just
// renders the list.
interface RouteOption {
  entryGate: string;
  exitGate: string;
  waypoints: { lat: number; lon: number; nome: string }[];
  corridorNames: string[];
  totalDistanceNm: number;
  altitudeRange: { min: number; max: number } | null;
  compulsoryAltitude: number | null;
}

interface Props {
  violations?: ReaViolation[];
  // Start of the segment being analysed (origin for main leg, destination for alternate leg).
  startPoint: ReaEndpoint | null;
  // End of the segment (destination for main leg, alternate aerodrome for alternate leg).
  endPoint: ReaEndpoint | null;
  followedCorridorName: string | null;
  onApplyCorridor: (data: ReaCorridorApplyData) => void;
}

export function ReaCorridorSuggestions(props: Props): JSX.Element {
  const { t } = useTranslation();
  const { violations = [], startPoint, endPoint, followedCorridorName, onApplyCorridor } = props;

  // Each option is a concrete (entry gate → exit gate) plan for the FIXED
  // segment endpoints. Picking one applies its full route verbatim — no
  // per-click recompute, no altitude coupling, no list mutation. This is why
  // the options stay stable and a corridor that's listed stays selectable
  // (the previous per-corridor model conflated entry/exit gates and let prior
  // picks change what was reachable).
  const [options, setOptions] = useState<RouteOption[]>([]);
  const [loading, setLoading] = useState(false);

  const sLat = startPoint?.latitude;
  const sLon = startPoint?.longitude;
  const eLat = endPoint?.latitude;
  const eLon = endPoint?.longitude;

  useEffect(() => {
    if (sLat == null || sLon == null || eLat == null || eLon == null) {
      setOptions([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    apiClient
      .get<{ options: RouteOption[] }>(
        `/rea/navigate/options?origin=${sLat}:${sLon}&destination=${eLat}:${eLon}`,
      )
      .then((r) => { if (!cancelled) setOptions(r.options); })
      .catch(() => { if (!cancelled) setOptions([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [sLat, sLon, eLat, eLon]);

  // Stale-while-revalidate: only show the bare loading text on the first load.
  if (loading && options.length === 0) {
    return <Text className="text-xs text-muted-foreground">{t('common.loading')}</Text>;
  }
  if (!loading && options.length === 0) {
    return <Text className="text-xs text-green-600 mb-2">{t('vfr.reaNoConflict')}</Text>;
  }

  return (
    <>
      {violations.length > 0 ? (
        <View className="mb-2">
          {violations.map((v, vi) => (
            <View
              key={vi}
              className={`flex-row items-start gap-1.5 mb-1 px-2 py-1 rounded ${v.severity === 'error' ? 'bg-red-50' : 'bg-amber-50'}`}
            >
              <Text className={`text-xs font-semibold ${v.severity === 'error' ? 'text-red-600' : 'text-amber-600'}`}>
                {v.severity === 'error' ? '✕' : '⚠'}
              </Text>
              <Text className={`text-xs flex-1 ${v.severity === 'error' ? 'text-red-700' : 'text-amber-700'}`}>
                {v.message}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      <View className="rounded border border-border overflow-hidden mb-2">
        {options.map((opt, idx) => {
          const key = `${opt.entryGate}>>${opt.exitGate}`;
          // The applied route is the full corridor path; match the parent's
          // followedCorridorName (set to the same joined string on apply) to
          // highlight the selected card.
          const joined = opt.corridorNames.join(' + ');
          const isFollowed = followedCorridorName === joined;
          // Options arrive sorted by distance — the shortest is the natural best.
          const isBest = idx === 0;
          return (
            <Pressable
              key={key}
              onPress={() =>
                onApplyCorridor({
                  waypoints: opt.waypoints.map((w) => ({ lat: w.lat, lng: w.lon, name: w.nome })),
                  corridorName: joined,
                  altRange: opt.altitudeRange,
                  compAlt: opt.compulsoryAltitude,
                })
              }
              className={`px-2 py-1.5 ${idx < options.length - 1 ? 'border-b border-border' : ''} ${isFollowed ? 'bg-green-50' : ''}`}
            >
              <View className="flex-row items-center gap-1.5 flex-wrap">
                <Text className="text-[10px] text-muted-foreground">{t('vfr.reaEntry')}</Text>
                <Text className="text-xs font-semibold text-foreground">{opt.entryGate}</Text>
                <Text className="text-muted-foreground">→</Text>
                <Text className="text-[10px] text-muted-foreground">{t('vfr.reaExit')}</Text>
                <Text className="text-xs font-semibold text-foreground">{opt.exitGate}</Text>
                <Text className="text-[10px] text-muted-foreground">· {opt.totalDistanceNm} NM</Text>
                {opt.compulsoryAltitude != null ? (
                  <Text className="text-[9px] font-semibold text-amber-600">{opt.compulsoryAltitude} ft ✦</Text>
                ) : opt.altitudeRange ? (
                  <Text className="text-[9px] text-muted-foreground">
                    {opt.altitudeRange.min}–{opt.altitudeRange.max} ft
                  </Text>
                ) : null}
                {isBest ? (
                  <View className="rounded px-1 py-0.5 bg-green-100">
                    <Text className="text-[8px] font-bold text-green-700">{t('vfr.reaBestMatch')}</Text>
                  </View>
                ) : null}
                {isFollowed ? (
                  <View className="rounded px-1 py-0.5 bg-green-600">
                    <Text className="text-[8px] font-bold text-white">✓ {t('vfr.reaFollow')}</Text>
                  </View>
                ) : null}
              </View>
              <Text className="text-[10px] text-muted-foreground mt-0.5" numberOfLines={1}>
                {opt.waypoints.map((w) => w.nome).filter(Boolean).join(' → ')}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </>
  );
}
