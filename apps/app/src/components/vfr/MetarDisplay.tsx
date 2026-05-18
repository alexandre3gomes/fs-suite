import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';

export interface ParsedMetar {
  icaoId: string;
  raw: string;
  observationTime: string;
  windDirection: number | string | null;
  windSpeed: number | null;
  windGust?: number | null;
  visibility: string | null;
  altimeter: number | null;
  temperature: number | null;
  dewpoint: number | null;
  clouds: { cover: string; base: number }[];
  flightCategory: string | null;
  ceiling: number | null;
  source?: 'adds' | 'noaa-text' | 'nearby';
  nearbyFrom?: string;
  nearbyDistanceNm?: number;
}

interface Props {
  metar: ParsedMetar | null;
  loading?: boolean;
}

function categoryColor(cat: string | null): string {
  switch (cat) {
    case 'VFR': return 'text-success';
    case 'MVFR': return 'text-primary';
    case 'IFR': return 'text-destructive';
    case 'LIFR': return 'text-destructive';
    default: return 'text-muted-foreground';
  }
}

function formatWind(dir: number | string | null, spd: number | null, gust?: number | null): string {
  if (dir === null || spd === null) return '—';
  const gustStr = gust ? `G${gust}` : '';
  if (dir === 'VRB') return `VRB ${spd}${gustStr}kt`;
  return `${String(dir).padStart(3, '0')}° / ${spd}${gustStr}kt`;
}

export function MetarDisplay({ metar, loading }: Props) {
  const { t } = useTranslation();

  if (loading) {
    return (
      <View className="mt-1 rounded-sm border border-border bg-surface-muted px-3 py-2">
        <Text className="text-xs text-muted-foreground">{t('common.loading')}</Text>
      </View>
    );
  }

  if (!metar) {
    return (
      <View className="mt-1 rounded-sm border border-border bg-surface-muted px-3 py-2">
        <Text className="text-xs text-muted-foreground">{t('vfr.noMetar')}</Text>
      </View>
    );
  }

  return (
    <View className="mt-1 rounded-sm border border-border bg-surface-muted px-3 py-2">
      {/* Nearby station indicator */}
      {metar.source === 'nearby' && metar.nearbyFrom ? (
        <Text className="mb-1 text-[10px] font-medium text-amber-600">
          {t('vfr.metarNearby', { station: metar.nearbyFrom, distance: metar.nearbyDistanceNm ?? '?' })}
        </Text>
      ) : null}

      {/* Raw METAR */}
      <Text className="mb-2 font-mono text-xs text-foreground" selectable>
        {metar.raw}
      </Text>

      {/* Parsed fields */}
      <View className="flex-row flex-wrap gap-x-4 gap-y-1">
        <View className="flex-row items-center gap-1">
          <Text className="text-xs text-muted-foreground">{t('vfr.wind')}:</Text>
          <Text className="text-xs font-medium text-foreground">
            {formatWind(metar.windDirection, metar.windSpeed, metar.windGust)}
          </Text>
        </View>

        <View className="flex-row items-center gap-1">
          <Text className="text-xs text-muted-foreground">{t('vfr.visibility')}:</Text>
          <Text className="text-xs font-medium text-foreground">
            {metar.visibility ?? '—'}
          </Text>
        </View>

        {metar.ceiling !== null ? (
          <View className="flex-row items-center gap-1">
            <Text className="text-xs text-muted-foreground">{t('vfr.ceiling')}:</Text>
            <Text className="text-xs font-medium text-foreground">
              {metar.ceiling} ft
            </Text>
          </View>
        ) : null}

        <View className="flex-row items-center gap-1">
          <Text className="text-xs text-muted-foreground">{t('vfr.temperature')}:</Text>
          <Text className="text-xs font-medium text-foreground">
            {metar.temperature !== null ? `${metar.temperature}°C` : '—'}
            {metar.dewpoint !== null ? ` / ${metar.dewpoint}°C` : ''}
          </Text>
        </View>

        <View className="flex-row items-center gap-1">
          <Text className="text-xs text-muted-foreground">{t('vfr.qnh')}:</Text>
          <Text className="text-xs font-medium text-foreground">
            {metar.altimeter ?? '—'} hPa
          </Text>
        </View>

        <View className="flex-row items-center gap-1">
          <Text className="text-xs text-muted-foreground">{t('vfr.category')}:</Text>
          <Text className={`text-xs font-bold ${categoryColor(metar.flightCategory)}`}>
            {metar.flightCategory ?? '—'}
          </Text>
        </View>
      </View>

      {/* Source attribution */}
      <Text className="mt-1.5 text-right text-[10px] italic text-muted-foreground">
        {t('vfr.metarSource')}
      </Text>
    </View>
  );
}
