import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';

export interface TafForecastPeriod {
  timeFrom: number;
  timeTo: number;
  timeBec: number | null;
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
  targetEpoch?: number;
  targetLabel?: string;
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

function fmtDayTime(epoch: number): string {
  const d = new Date(epoch * 1000);
  const day = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return mm === '00' ? `${day}/${hh}Z` : `${day}/${hh}${mm}Z`;
}

function formatWind(dir: number | null, spd: number | null, gst: number | null): string {
  if (dir === null || spd === null) return '—';
  const base = `${String(dir).padStart(3, '0')}°/${spd}kt`;
  return gst ? `${base} G${gst}kt` : base;
}

function formatVis(vis: number | string | null): string {
  if (vis === null) return '—';
  if (typeof vis === 'string') return vis === '6+' ? '> 10 km' : `${vis} SM`;
  if (vis >= 6) return '> 10 km';
  const meters = Math.round(vis * 1609.34);
  return `${meters} m`;
}

function formatClouds(clouds: { cover: string; base: number | null }[]): string {
  if (clouds.length === 0) return '—';
  return clouds.map((c) => {
    if (c.cover === 'NSC' || c.cover === 'SKC' || c.cover === 'CLR' || c.cover === 'NCD') return c.cover;
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

function periodTimeLabel(period: TafForecastPeriod): string {
  if (period.fcstChange === 'BECMG' && period.timeBec) {
    return `${fmtDayTime(period.timeFrom)}–${fmtDayTime(period.timeBec)}`;
  }
  return `${fmtDayTime(period.timeFrom)}–${fmtDayTime(period.timeTo)}`;
}

function changeLabel(change: string | null, prob: number | null): string | null {
  if (!change) return null;
  if (change === 'PROB' && prob) return `PROB${prob}`;
  return change;
}

function isPeriodAtTarget(p: TafForecastPeriod, targetEpoch: number | undefined): boolean {
  if (!targetEpoch) return false;
  return targetEpoch >= p.timeFrom && targetEpoch < p.timeTo;
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-center gap-1">
      <Text className="text-[10px] text-muted-foreground">{label}:</Text>
      <Text className="text-[10px] font-medium text-foreground">{value}</Text>
    </View>
  );
}

export function TafDisplay({ taf, loading, targetEpoch, targetLabel }: Props) {
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

  const label = targetLabel ?? 'ETA';

  return (
    <View className="mt-1 rounded-sm border border-border bg-surface-muted px-3 py-2">
      <Text className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        TAF — {fmtDayTime(taf.validFrom)}–{fmtDayTime(taf.validTo)}
      </Text>

      <Text className="mb-2 font-mono text-xs text-foreground" selectable>
        {taf.raw}
      </Text>

      {taf.periods.map((period, idx) => {
        const isEta = isPeriodAtTarget(period, targetEpoch);
        const change = changeLabel(period.fcstChange, period.probability);
        const cavok = isCavok(period);
        const timeLabel = periodTimeLabel(period);
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
                {timeLabel}
              </Text>
              {change ? (
                <View className="rounded bg-amber-100 px-1.5 py-0.5">
                  <Text className="text-[9px] font-bold text-amber-700">{change}</Text>
                </View>
              ) : null}
              {isEta ? (
                <View className="rounded bg-primary/20 px-1.5 py-0.5">
                  <Text className="text-[9px] font-bold text-primary">{label}</Text>
                </View>
              ) : null}
              <Text className={`ml-auto text-[10px] font-bold ${categoryColor(period.flightCategory)}`}>
                {period.flightCategory ?? ''}
              </Text>
            </View>

            <View className="flex-row flex-wrap gap-x-4 gap-y-0.5">
              <Field label={t('vfr.wind')} value={formatWind(period.windDirection, period.windSpeed, period.windGust)} />

              {cavok ? (
                <View className="flex-row items-center gap-1">
                  <Text className="text-[10px] font-bold text-success">CAVOK</Text>
                </View>
              ) : (
                <>
                  <Field label={t('vfr.visibility')} value={formatVis(period.visibility)} />

                  {ceiling !== null ? (
                    <Field label={t('vfr.ceiling')} value={`${ceiling} ft`} />
                  ) : null}

                  <Field label={t('vfr.clouds')} value={formatClouds(period.clouds)} />

                  {period.wxString ? (
                    <Field label="Wx" value={period.wxString} />
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
