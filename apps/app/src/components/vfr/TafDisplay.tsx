import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';

export interface TafForecastPeriod {
  timeFrom: number;
  timeTo: number;
  fcstChange: string | null;
  probability: number | null;
  windDirection: number | null;
  windSpeed: number | null;
  windGust: number | null;
  visibility: number | string | null;
  wxString: string | null;
  clouds: { cover: string; base: number | null }[];
  flightCategory: string | null;
}

export interface ParsedTaf {
  icaoId: string;
  raw: string;
  issueTime: string;
  validFrom: number;
  validTo: number;
  periods: TafForecastPeriod[];
}

interface Props {
  taf: ParsedTaf | null;
  loading?: boolean;
  etaMinutes?: number;
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

function formatUtcTime(epoch: number): string {
  const d = new Date(epoch * 1000);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}Z`;
}

function formatWind(dir: number | null, spd: number | null, gst: number | null): string {
  if (dir === null || spd === null) return '—';
  const base = `${String(dir).padStart(3, '0')}°/${spd}kt`;
  return gst ? `${base} G${gst}kt` : base;
}

function formatVis(vis: number | string | null): string {
  if (vis === null) return '—';
  if (typeof vis === 'string') return vis === '6+' ? '> 6 SM' : `${vis} SM`;
  return `${vis.toFixed(1)} SM`;
}

function formatClouds(clouds: { cover: string; base: number | null }[]): string {
  if (clouds.length === 0) return '—';
  return clouds.map((c) => {
    if (c.cover === 'NSC' || c.cover === 'SKC' || c.cover === 'CLR') return c.cover;
    return `${c.cover}${c.base != null ? ` ${c.base}ft` : ''}`;
  }).join(', ');
}

function isCavok(period: TafForecastPeriod): boolean {
  const vis = period.visibility;
  const visOk = vis === '6+' || (typeof vis === 'number' && vis >= 6);
  const cloudsOk = period.clouds.length === 0 ||
    period.clouds.every((c) => c.cover === 'NSC' || c.cover === 'SKC' || c.cover === 'CLR' || c.cover === 'NCD');
  return visOk && cloudsOk && !period.wxString;
}

function changeLabel(change: string | null, prob: number | null): string | null {
  if (!change) return null;
  const parts: string[] = [];
  if (change === 'BECMG') parts.push('BECMG');
  else if (change === 'TEMPO') parts.push('TEMPO');
  else if (change === 'PROB') parts.push('PROB');
  else if (change === 'FM') parts.push('FM');
  else parts.push(change);
  if (prob) parts.push(`${prob}%`);
  return parts.join(' ');
}

function getEtaEpoch(etaMinutes?: number): number | null {
  if (!etaMinutes) return null;
  return Math.floor(Date.now() / 1000) + etaMinutes * 60;
}

function isPeriodAtEta(p: TafForecastPeriod, etaEpoch: number | null): boolean {
  if (!etaEpoch) return false;
  return etaEpoch >= p.timeFrom && etaEpoch < p.timeTo;
}

export function TafDisplay({ taf, loading, etaMinutes }: Props) {
  const { t } = useTranslation();

  if (loading) {
    return (
      <View className="mt-1 rounded-sm border border-border bg-surface-muted px-3 py-2">
        <Text className="text-xs text-muted-foreground">{t('common.loading')}</Text>
      </View>
    );
  }

  if (!taf) {
    return (
      <View className="mt-1 rounded-sm border border-border bg-surface-muted px-3 py-2">
        <Text className="text-xs text-muted-foreground">{t('vfr.noTaf')}</Text>
      </View>
    );
  }

  const etaEpoch = getEtaEpoch(etaMinutes);

  return (
    <View className="mt-1 rounded-sm border border-border bg-surface-muted px-3 py-2">
      <Text className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        TAF
      </Text>

      <Text className="mb-2 font-mono text-xs text-foreground" selectable>
        {taf.raw}
      </Text>

      {taf.periods.map((period, idx) => {
        const isEta = isPeriodAtEta(period, etaEpoch);
        const change = changeLabel(period.fcstChange, period.probability);
        const cavok = isCavok(period);
        const ceiling = !cavok
          ? period.clouds
              .filter((c) => (c.cover === 'BKN' || c.cover === 'OVC') && c.base != null)
              .sort((a, b) => (a.base ?? 99999) - (b.base ?? 99999))[0]?.base ?? null
          : null;

        return (
          <View
            key={idx}
            className={`mb-1.5 rounded-md border px-2.5 py-2 ${
              isEta
                ? 'border-primary/40 bg-primary/10'
                : 'border-border/50 bg-surface'
            }`}
          >
            <View className="mb-1 flex-row items-center gap-2">
              <Text className="text-[10px] font-bold text-muted-foreground">
                {formatUtcTime(period.timeFrom)}–{formatUtcTime(period.timeTo)}
              </Text>
              {change ? (
                <View className="rounded bg-amber-100 px-1.5 py-0.5">
                  <Text className="text-[9px] font-bold text-amber-700">{change}</Text>
                </View>
              ) : null}
              {isEta ? (
                <View className="rounded bg-primary/20 px-1.5 py-0.5">
                  <Text className="text-[9px] font-bold text-primary">ETA</Text>
                </View>
              ) : null}
              <Text className={`ml-auto text-[10px] font-bold ${categoryColor(period.flightCategory)}`}>
                {period.flightCategory ?? ''}
              </Text>
            </View>

            <View className="flex-row flex-wrap gap-x-4 gap-y-0.5">
              <View className="flex-row items-center gap-1">
                <Text className="text-[10px] text-muted-foreground">{t('vfr.wind')}:</Text>
                <Text className="text-[10px] font-medium text-foreground">
                  {formatWind(period.windDirection, period.windSpeed, period.windGust)}
                </Text>
              </View>

              {cavok ? (
                <View className="flex-row items-center gap-1">
                  <Text className="text-[10px] font-bold text-success">CAVOK</Text>
                </View>
              ) : (
                <>
                  <View className="flex-row items-center gap-1">
                    <Text className="text-[10px] text-muted-foreground">{t('vfr.visibility')}:</Text>
                    <Text className="text-[10px] font-medium text-foreground">
                      {formatVis(period.visibility)}
                    </Text>
                  </View>

                  {ceiling !== null ? (
                    <View className="flex-row items-center gap-1">
                      <Text className="text-[10px] text-muted-foreground">{t('vfr.ceiling')}:</Text>
                      <Text className="text-[10px] font-medium text-foreground">{ceiling} ft</Text>
                    </View>
                  ) : null}

                  <View className="flex-row items-center gap-1">
                    <Text className="text-[10px] text-muted-foreground">{t('vfr.clouds')}:</Text>
                    <Text className="text-[10px] font-medium text-foreground">
                      {formatClouds(period.clouds)}
                    </Text>
                  </View>

                  {period.wxString ? (
                    <View className="flex-row items-center gap-1">
                      <Text className="text-[10px] text-muted-foreground">Wx:</Text>
                      <Text className="text-[10px] font-medium text-foreground">{period.wxString}</Text>
                    </View>
                  ) : null}
                </>
              )}
            </View>
          </View>
        );
      })}

      <Text className="mt-0.5 text-right text-[10px] italic text-muted-foreground">
        {t('vfr.metarSource')}
      </Text>
    </View>
  );
}
