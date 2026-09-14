import type { FlightPlan } from '@fs-suite/types';
import { Button, Spinner, Text, colors } from '@fs-suite/ui';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';

import { useCurrentUser } from '../../../src/hooks/useCurrentUser';
import { useFlightCategories } from '../../../src/hooks/useFlightCategories';
import { useFlightPlans, pickNextFlight } from '../../../src/hooks/useFlightPlans';
import { useIsDesktop } from '../../../src/hooks/useIsDesktop';
import {
  deriveReadiness,
  firstBlocker,
  formatDuration,
  formatZulu,
  type CheckState,
  type ReadinessCheck,
} from '../../../src/lib/readiness';
import { trackAction } from '../../../src/services/analytics';
import { formatFuel, formatWeight, useUnitsStore } from '../../../src/stores/units.store';

/** The bar at the top of a readiness cell. Red only ever means blocked. */
const STATE_COLOR: Record<CheckState, string> = {
  ok: colors.rule,
  warn: colors.primary,
  fail: colors.destructive,
  unknown: colors.ruleSoft,
};

const STATE_TEXT: Record<CheckState, string> = {
  ok: 'text-foreground',
  warn: 'text-primary',
  fail: 'text-destructive',
  unknown: 'text-muted-foreground',
};

export default function DashboardScreen(): JSX.Element {
  const { t } = useTranslation();
  const router = useRouter();
  const isDesktop = useIsDesktop();
  const { user, isLoading: userLoading } = useCurrentUser();
  const { plans, loading: plansLoading } = useFlightPlans();
  const fuelUnit = useUnitsStore((s) => s.fuel);
  const weightUnit = useUnitsStore((s) => s.weight);

  const next = useMemo(() => pickNextFlight(plans), [plans]);
  const { byIcao, loading: wxLoading } = useFlightCategories([
    next?.originIcao,
    next?.destinationIcao,
    next?.alternateIcao,
  ]);

  const checks = useMemo(() => deriveReadiness(next, byIcao), [next, byIcao]);
  const blocker = firstBlocker(checks);

  const pad = isDesktop ? 'px-8' : 'px-4';
  const now = new Date();

  const openPlan = (plan: FlightPlan) => {
    trackAction('cta_clicked', { cta: 'flight_plan', from: 'dashboard' });
    router.push(('/(auth)/flight-plans/' + plan.id) as never);
  };

  if ((userLoading && !user) || plansLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-background" testID="ops-board-loading">
        <Spinner size="lg" />
      </View>
    );
  }

  /** Reason text for a check, formatted through the user's own units. */
  const noteFor = (check: ReadinessCheck): string => {
    const p = check.noteParams ?? {};
    const params: Record<string, string | number> = { ...p };
    const onBoardKg = p['onBoardKg'];
    const requiredKg = p['requiredKg'];
    const takeoffKg = p['takeoffKg'];
    const mtowKg = p['mtowKg'];
    if (typeof onBoardKg === 'number') params['onBoard'] = formatFuel(onBoardKg, fuelUnit);
    if (typeof requiredKg === 'number') params['required'] = formatFuel(requiredKg, fuelUnit);
    if (typeof takeoffKg === 'number') params['takeoff'] = formatWeight(takeoffKg, weightUnit);
    if (typeof mtowKg === 'number') params['mtow'] = formatWeight(mtowKg, weightUnit);
    return t(check.noteKey, params);
  };

  const metrics = next
    ? [
        {
          key: 'distance',
          labelKey: 'ops.metricDistance',
          value:
            next.totalDistanceNm !== null && next.totalDistanceNm !== undefined
              ? next.totalDistanceNm.toFixed(1)
              : '—',
          sub: t('ops.metricDistanceSub', { waypoints: next.routes?.length ?? 0 }),
        },
        {
          key: 'ete',
          labelKey: 'ops.metricEte',
          value: formatDuration(next.estimatedElapsedMin),
          sub: t('ops.metricEteSub', {
            speed: next.cruiseSpeedKts ?? '—',
            altitude: next.plannedAltitude ?? next.cruiseLevel ?? '—',
          }),
        },
        {
          key: 'fuel',
          labelKey: 'ops.metricFuel',
          value:
            next.fuelRequiredTotal !== null && next.fuelRequiredTotal !== undefined
              ? formatFuel(next.fuelRequiredTotal, fuelUnit)
              : '—',
          sub:
            next.fuelCurrentTotal !== null && next.fuelCurrentTotal !== undefined
              ? t('ops.metricFuelSub', { onBoard: formatFuel(next.fuelCurrentTotal, fuelUnit) })
              : t('ops.metricFuelNoData'),
        },
        {
          key: 'endurance',
          labelKey: 'ops.metricEndurance',
          value: formatDuration(next.enduranceMinutes),
          sub:
            next.fuelConsumptionPerHour !== null && next.fuelConsumptionPerHour !== undefined
              ? t('ops.metricEnduranceSub', {
                  burn: formatFuel(next.fuelConsumptionPerHour, fuelUnit),
                })
              : t('ops.metricEnduranceNoData'),
        },
      ]
    : [];

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerStyle={{ paddingBottom: 32 }}
      testID="ops-board"
    >
      {/* ── PAGE HEADER ─────────────────────────────────────── */}
      <View
        className={
          'border-b-2 border-rule ' +
          pad +
          (isDesktop ? ' flex-row items-end justify-between py-6' : ' py-5')
        }
      >
        <View style={{ minWidth: 0 }}>
          <Text variant="kicker">{formatZulu(now)}</Text>
          <Text variant={isDesktop ? 'h1' : 'h2'} className="mt-2" testID="ops-board-title">
            {t('nav.opsBoard')}
          </Text>
        </View>
        <View className={isDesktop ? 'flex-row gap-3' : 'mt-4 flex-row gap-3'}>
          <Button
            testID="new-flight-plan"
            onPress={() => {
              trackAction('cta_clicked', { cta: 'new_flight_plan', from: 'dashboard' });
              router.push('/(auth)/flight-plans/new' as never);
            }}
          >
            <Text>{t('dashboard.newPlan')}</Text>
          </Button>
          <Button variant="secondary" onPress={() => router.push('/(auth)/flight-plans' as never)}>
            <Text>{t('dashboard.myPlans')}</Text>
          </Button>
        </View>
      </View>

      {next === null ? (
        /* ── EMPTY STATE ───────────────────────────────────── */
        <View className={'border-b-2 border-rule py-16 ' + pad} testID="ops-board-empty">
          <Text variant="label">{t('ops.nextFlight')}</Text>
          <Text variant={isDesktop ? 'h2' : 'h3'} className="mt-3" style={{ maxWidth: 520 }}>
            {t('ops.emptyTitle')}
          </Text>
          <Text variant="muted" className="mt-3" style={{ maxWidth: 480 }}>
            {t('ops.emptyBody')}
          </Text>
          <View className="mt-6 flex-row">
            <Button onPress={() => router.push('/(auth)/flight-plans/new' as never)}>
              <Text>{t('dashboard.newPlan')}</Text>
            </Button>
          </View>
        </View>
      ) : (
        <>
          {/* ── NEXT FLIGHT + READINESS ───────────────────────── */}
          <View className={'border-b-2 border-rule py-6 ' + pad}>
            <View className={isDesktop ? 'flex-row gap-10' : ''}>
              <View style={isDesktop ? { flexBasis: 300, flexGrow: 0, flexShrink: 0 } : undefined}>
                <Text variant="label">{t('ops.nextFlight')}</Text>
                <Pressable onPress={() => openPlan(next)} className="mt-3" testID="next-flight">
                  <Text variant={isDesktop ? 'h1' : 'h2'}>
                    {next.originIcao + ' → ' + next.destinationIcao}
                  </Text>
                </Pressable>
                <Text variant="muted" className="mt-2" numberOfLines={2}>
                  {next.originName + ' — ' + next.destinationName}
                </Text>

                <View className="mt-4 border-t-2 border-rule pt-3">
                  <Text variant="label">{t('ops.departure')}</Text>
                  <Text variant="small" className="mt-1">
                    {formatZulu(next.plannedDepartureUtc)}
                  </Text>
                </View>
                <View className="mt-3 border-t border-border pt-3">
                  <Text variant="label">{t('ops.aircraft')}</Text>
                  <Text variant="small" className="mt-1">
                    {[next.registration, next.aircraftName ?? next.aircraftType]
                      .filter(Boolean)
                      .join(' · ') || t('ops.noAircraft')}
                  </Text>
                </View>
                <View className="mt-3 border-t border-border pt-3">
                  <Text variant="label">{t('ops.rules')}</Text>
                  <Text variant="small" className="mt-1">
                    {t('flightRules.' + next.flightRules, { defaultValue: next.flightRules })}
                  </Text>
                </View>
              </View>

              {/* Five checks, each a ruled cell. */}
              <View style={{ flex: 1, minWidth: 0 }} className={isDesktop ? '' : 'mt-6'}>
                <Text variant="label">{t('ops.readiness')}</Text>
                <View
                  className="mt-2 flex-row flex-wrap border-t-2 border-rule"
                  testID="readiness-grid"
                >
                  {checks.map((check) => (
                    <View
                      key={check.id}
                      testID={'readiness-' + check.id}
                      className="border-b border-r border-border p-3"
                      style={{
                        flexBasis: isDesktop ? '20%' : '50%',
                        flexGrow: 1,
                        minWidth: isDesktop ? 0 : 140,
                      }}
                    >
                      <View
                        style={{ height: 4, width: 28, backgroundColor: STATE_COLOR[check.state] }}
                      />
                      <Text variant="label" className="mt-3">
                        {t(check.labelKey)}
                      </Text>
                      <Text
                        variant="large"
                        className={'mt-1 ' + STATE_TEXT[check.state]}
                        numberOfLines={1}
                      >
                        {wxLoading && check.id === 'weather' ? '…' : t(check.stateKey)}
                      </Text>
                      <Text variant="muted" className="mt-2 text-[12px]">
                        {noteFor(check)}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
            </View>
          </View>

          {/* ── BLOCKER BANNER ───────────────────────────────── */}
          {blocker ? (
            <View
              testID="readiness-blocker"
              className={
                'flex-row flex-wrap items-center justify-between gap-4 bg-destructive py-4 ' + pad
              }
            >
              <Text
                className="font-sans text-[14px] font-bold text-destructive-foreground"
                style={{ flexShrink: 1 }}
              >
                {t(blocker.labelKey) + ' — ' + noteFor(blocker)}
              </Text>
              <Pressable
                onPress={() => openPlan(next)}
                className="bg-background px-4 py-2"
                accessibilityRole="button"
              >
                <Text variant="labelInk">{t('ops.fixInPlan')}</Text>
              </Pressable>
            </View>
          ) : null}

          {/* ── ROUTE METRICS ────────────────────────────────── */}
          <View className="flex-row flex-wrap border-b-2 border-rule">
            {metrics.map((metric) => (
              <View
                key={metric.key}
                className={'border-r border-border py-5 ' + pad}
                style={{ flexBasis: isDesktop ? '25%' : '50%', flexGrow: 1, minWidth: 0 }}
              >
                <Text variant="label">{t(metric.labelKey)}</Text>
                <Text
                  variant={isDesktop ? 'metric' : 'metricSm'}
                  className="mt-2"
                  numberOfLines={1}
                >
                  {metric.value}
                </Text>
                <Text variant="muted" className="mt-2 text-[12px]" numberOfLines={2}>
                  {metric.sub}
                </Text>
              </View>
            ))}
          </View>

          {/* ── PLANS + WEATHER ──────────────────────────────── */}
          <View className={isDesktop ? 'flex-row' : ''}>
            <View
              className={
                'border-b border-border py-6 ' + pad + (isDesktop ? ' border-r-2 border-r-rule' : '')
              }
              style={{ flexBasis: isDesktop ? '58%' : undefined, flexGrow: 1, minWidth: 0 }}
            >
              <View className="flex-row items-baseline justify-between border-b-2 border-rule pb-2">
                <Text variant="labelInk">{t('ops.recentPlans')}</Text>
                <Pressable onPress={() => router.push('/(auth)/flight-plans' as never)}>
                  <Text variant="label" className="text-accent">
                    {t('ops.allPlans')}
                  </Text>
                </Pressable>
              </View>
              {plans.slice(0, 5).map((plan) => (
                <Pressable
                  key={plan.id}
                  onPress={() => openPlan(plan)}
                  className="flex-row items-center justify-between gap-4 border-b border-border py-3"
                >
                  <View style={{ minWidth: 0, flexShrink: 1 }}>
                    <Text variant="large">{plan.originIcao + ' → ' + plan.destinationIcao}</Text>
                    <Text variant="muted" className="mt-1 text-[12px]" numberOfLines={1}>
                      {formatZulu(plan.plannedDepartureUtc ?? plan.updatedAt)}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text variant="label">
                      {t('flightRules.' + plan.flightRules, { defaultValue: plan.flightRules })}
                    </Text>
                    <Text variant="label" className="mt-1">
                      {t('planStatus.' + plan.status, { defaultValue: plan.status })}
                    </Text>
                  </View>
                </Pressable>
              ))}
            </View>

            <View
              className={'border-b border-border py-6 ' + pad}
              style={{ flexBasis: isDesktop ? '42%' : undefined, flexGrow: 1, minWidth: 0 }}
            >
              <Text variant="labelInk" className="border-b-2 border-rule pb-2">
                {t('ops.weatherStations')}
              </Text>
              {[next.originIcao, next.destinationIcao, next.alternateIcao]
                .filter((icao): icao is string => !!icao)
                .map((icao) => {
                  const row = byIcao[icao];
                  const category = row?.flightCategory ?? null;
                  const below = category === 'IFR' || category === 'LIFR';
                  return (
                    <View
                      key={icao}
                      className="border-b border-border py-3"
                      testID={'wx-station-' + icao}
                    >
                      <View className="flex-row items-center justify-between gap-3">
                        <Text variant="large">{icao}</Text>
                        <Text
                          variant="labelInk"
                          className={
                            below
                              ? 'text-destructive'
                              : category === 'MVFR'
                                ? 'text-primary'
                                : 'text-foreground'
                          }
                        >
                          {wxLoading ? '…' : (category ?? '—')}
                        </Text>
                      </View>
                      {/* A category inferred from another aerodrome says so. */}
                      {row?.derived ? (
                        <Text variant="muted" className="mt-2 text-[11px]">
                          {t('ops.wxDerived', {
                            station: row.referenceStation ?? '—',
                            distance:
                              row.referenceDistanceNm !== undefined
                                ? row.referenceDistanceNm.toFixed(0)
                                : '—',
                          })}
                        </Text>
                      ) : null}
                    </View>
                  );
                })}
              <Text variant="muted" className="mt-3 text-[11px]">
                {t('ops.wxSource')}
              </Text>
            </View>
          </View>
        </>
      )}
    </ScrollView>
  );
}
