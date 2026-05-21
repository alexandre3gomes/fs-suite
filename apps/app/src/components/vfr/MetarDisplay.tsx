import type { ParsedMetar } from '@fs-suite/types';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';

export type { ParsedMetar } from '@fs-suite/types';

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

      {/* Stale METAR indicator (> 1h old) */}
      {(() => {
        const ageH = Math.round((Date.now() - new Date(metar.observationTime).getTime()) / 3_600_000);
        return ageH >= 2 ? (
          <Text className="mb-1 text-[10px] font-medium text-amber-600">
            {t('vfr.metarStale', { hours: ageH })}
          </Text>
        ) : null;
      })()}

      {/* Raw METAR */}
      <Text className="mb-2 font-mono text-xs text-foreground" selectable>
        {metar.raw}
      </Text>

      {/* Decoded text (human-readable) */}
      {metar.decodedText ? (
        <Text className="mb-2 text-xs italic text-muted-foreground">
          {metar.decodedText}
        </Text>
      ) : null}

      {/* Present weather badges */}
      {metar.presentWeather && metar.presentWeather.length > 0 ? (
        <View className="mb-1.5 flex-row flex-wrap gap-1">
          {metar.presentWeather.map((wx) => (
            <View key={wx} className="rounded bg-amber-100 px-1.5 py-0.5 dark:bg-amber-900/30">
              <Text className="text-[10px] font-semibold text-amber-800 dark:text-amber-300">{wx}</Text>
            </View>
          ))}
        </View>
      ) : null}

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

      {/* Remarks: windshear */}
      {metar.remarks?.windshear ? (
        <View className="mt-1.5 rounded bg-destructive/10 px-2 py-1">
          <Text className="text-[10px] font-semibold text-destructive">
            ⚠ {metar.remarks.windshear}
          </Text>
        </View>
      ) : null}

      {/* Source attribution */}
      <Text className="mt-1.5 text-right text-[10px] italic text-muted-foreground">
        {t('vfr.metarSource')}
      </Text>
    </View>
  );
}
