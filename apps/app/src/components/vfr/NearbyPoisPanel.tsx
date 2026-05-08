import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Image, Pressable, Text, View } from 'react-native';

// --------------- Types ---------------

interface WikiPoi {
  pageId: number;
  title: string;
  lat: number;
  lng: number;
  distNm: number;
}

interface Props {
  lat: number;
  lng: number;
  radiusNm: number;
  legLabel: string;
}

// --------------- Satellite imagery ---------------

const ZOOM_LEVELS = [
  { label: '15 NM', spanDeg: 0.25 },
  { label: '8 NM', spanDeg: 0.13 },
  { label: '3 NM', spanDeg: 0.05 },
] as const;

function satelliteUrl(lat: number, lng: number, spanDeg: number, w: number, h: number): string {
  const aspect = h / w;
  const minLon = lng - spanDeg;
  const maxLon = lng + spanDeg;
  const minLat = lat - spanDeg * aspect;
  const maxLat = lat + spanDeg * aspect;
  return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export?bbox=${minLon},${minLat},${maxLon},${maxLat}&bboxSR=4326&size=${w},${h}&imageSR=4326&format=png&f=image`;
}

// --------------- Wikipedia POIs ---------------

const NM_TO_METERS = 1852;
const MAX_RADIUS_M = 10000;

async function fetchPois(lat: number, lng: number, radiusNm: number): Promise<WikiPoi[]> {
  const radiusM = Math.min(Math.round(radiusNm * NM_TO_METERS), MAX_RADIUS_M);

  const fetchLang = async (lang: string): Promise<WikiPoi[]> => {
    const base = `https://${lang}.wikipedia.org/w/api.php`;
    const url = `${base}?action=query&list=geosearch&gscoord=${lat}|${lng}&gsradius=${radiusM}&gslimit=15&format=json&origin=*`;
    const resp = await fetch(url);
    const data = (await resp.json()) as {
      query?: { geosearch?: { pageid: number; title: string; lat: number; lon: number; dist: number }[] };
    };
    return (data.query?.geosearch ?? []).map((p) => ({
      pageId: p.pageid,
      title: p.title,
      lat: p.lat,
      lng: p.lon,
      distNm: p.dist / NM_TO_METERS,
    }));
  };

  try {
    const [pt, en] = await Promise.all([
      fetchLang('pt').catch(() => [] as WikiPoi[]),
      fetchLang('en').catch(() => [] as WikiPoi[]),
    ]);

    const merged: WikiPoi[] = [...pt];
    const seen = new Set(pt.map((p) => `${p.lat.toFixed(3)},${p.lng.toFixed(3)}`));
    for (const poi of en) {
      const key = `${poi.lat.toFixed(3)},${poi.lng.toFixed(3)}`;
      if (!seen.has(key)) { seen.add(key); merged.push(poi); }
    }
    return merged.sort((a, b) => a.distNm - b.distNm).slice(0, 12);
  } catch {
    return [];
  }
}

// --------------- Component ---------------

export function NearbyPoisPanel({ lat, lng, radiusNm, legLabel }: Props) {
  const { t } = useTranslation();
  const [zoom, setZoom] = useState(1);
  const [pois, setPois] = useState<WikiPoi[]>([]);
  const [poisLoading, setPoisLoading] = useState(true);
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    void fetchPois(lat, lng, radiusNm).then((r) => { setPois(r); setPoisLoading(false); });
  }, [lat, lng, radiusNm]);

  const level = ZOOM_LEVELS[zoom]!;
  const mainImg = satelliteUrl(lat, lng, level.spanDeg, 600, 340);

  return (
    <View className="border-b border-border bg-surface-muted px-2 py-2.5">
      {/* Header */}
      <View className="mb-1.5 flex-row items-center justify-between">
        <Text className="text-[10px] font-semibold text-muted-foreground">
          {t('vfr.nearbyReferences')} — {legLabel}
        </Text>
        {/* Zoom buttons */}
        <View className="flex-row gap-1">
          {ZOOM_LEVELS.map((z, i) => (
            <Pressable
              key={z.label}
              onPress={() => setZoom(i)}
              className={`rounded-sm border px-2 py-0.5 ${
                i === zoom ? 'border-primary bg-primary/10' : 'border-border bg-surface'
              }`}
            >
              <Text className={`text-[9px] font-medium ${i === zoom ? 'text-primary' : 'text-muted-foreground'}`}>
                {z.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {/* Satellite image — aerial view like the pilot sees */}
      <View className="mb-2 overflow-hidden rounded-md border border-border" style={{ position: 'relative' }}>
        <Image
          source={{ uri: mainImg }}
          style={{ width: '100%', height: 240 }}
          resizeMode="cover"
        />
        {/* Center crosshair */}
        <View
          style={{ position: 'absolute', top: '50%', left: '50%', transform: [{ translateX: -6 }, { translateY: -6 }] }}
          pointerEvents="none"
        >
          <Text style={{ fontSize: 12, color: '#ef4444', fontWeight: '800', textShadowColor: '#fff', textShadowRadius: 3 }}>+</Text>
        </View>
        {/* Scale label */}
        <View style={{ position: 'absolute', bottom: 4, right: 6 }} pointerEvents="none">
          <Text style={{ fontSize: 9, fontWeight: '700', color: '#fff', textShadowColor: 'rgba(0,0,0,0.8)', textShadowRadius: 2 }}>
            {level.label}
          </Text>
        </View>
      </View>

      {/* Thumbnail strip — all 3 zoom levels */}
      <View className="mb-2 flex-row gap-1.5">
        {ZOOM_LEVELS.map((z, i) => (
          <Pressable
            key={z.label}
            onPress={() => setZoom(i)}
            style={{
              flex: 1, borderRadius: 4, overflow: 'hidden',
              borderWidth: i === zoom ? 2 : 1,
              borderColor: i === zoom ? '#2563eb' : '#e5e7eb',
            }}
          >
            <Image
              source={{ uri: satelliteUrl(lat, lng, z.spanDeg, 200, 110) }}
              style={{ width: '100%', height: 56 }}
              resizeMode="cover"
            />
            <Text
              style={{
                position: 'absolute', bottom: 2, right: 4,
                fontSize: 8, fontWeight: '700', color: '#fff',
                textShadowColor: 'rgba(0,0,0,0.8)', textShadowRadius: 2,
              }}
            >
              {z.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Nearby landmarks */}
      <Text className="mb-1 text-[10px] font-semibold text-muted-foreground">
        {t('vfr.nearbyLandmarks')}
      </Text>
      {poisLoading ? (
        <Text className="text-[10px] text-muted-foreground">{t('common.loading')}</Text>
      ) : pois.length === 0 ? (
        <Text className="text-[10px] text-muted-foreground">{t('vfr.noNearbyPois')}</Text>
      ) : (
        <View className="flex-row flex-wrap gap-1">
          {pois.map((poi) => (
            <View
              key={poi.pageId}
              className="flex-row items-center gap-1 rounded-sm border border-border bg-surface px-1.5 py-0.5"
            >
              <Text className="text-[9px] font-medium text-foreground" numberOfLines={1}>
                {poi.title}
              </Text>
              <Text className="text-[8px] text-muted-foreground">
                {poi.distNm.toFixed(1)} NM
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}
