import type { FlightPlan } from '@fs-suite/types';
import { Button, Spinner, Text } from '@fs-suite/ui';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';

import { useFlightPlans } from '../../../src/hooks/useFlightPlans';
import { useIsDesktop } from '../../../src/hooks/useIsDesktop';
import { formatDuration, formatZulu } from '../../../src/lib/readiness';
import { setFeatureContext, trackAction } from '../../../src/services/analytics';

type FilterId = 'all' | 'draft' | 'completed' | 'vfr' | 'ifr';

const FILTERS: { id: FilterId; key: string }[] = [
  { id: 'all', key: 'plans.filterAll' },
  { id: 'draft', key: 'vfr.draft' },
  { id: 'completed', key: 'vfr.completed' },
  { id: 'vfr', key: 'plans.filterVfr' },
  { id: 'ifr', key: 'plans.filterIfr' },
];

function matches(plan: FlightPlan, filter: FilterId): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'draft':
      return plan.status !== 'COMPLETED';
    case 'completed':
      return plan.status === 'COMPLETED';
    case 'vfr':
      return plan.flightRules === 'VFR' || plan.flightRules === 'VFR_IFR';
    case 'ifr':
      return plan.flightRules === 'IFR' || plan.flightRules === 'IFR_VFR';
  }
}

export default function VfrPlansListScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const isDesktop = useIsDesktop();
  const { plans, loading, refresh } = useFlightPlans();
  const [filter, setFilter] = useState<FilterId>('all');
  const trackedRef = useRef(false);

  useEffect(() => { setFeatureContext('flight_plans'); return () => setFeatureContext(null); }, []);

  // Preserved from the previous screen: report the list once it has loaded.
  useEffect(() => {
    if (loading || trackedRef.current) return;
    trackedRef.current = true;
    trackAction('flight_plan_list_viewed', {
      plan_count: plans.length,
      is_empty: plans.length === 0,
    });
  }, [loading, plans.length]);

  // Refetch whenever the screen gains focus (e.g., after coming back from editor)
  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));

  const visible = useMemo(() => plans.filter((p) => matches(p, filter)), [plans, filter]);
  const draftCount = plans.filter((p) => p.status !== 'COMPLETED').length;
  const pad = isDesktop ? 'px-8' : 'px-4';

  const open = (plan: FlightPlan) => {
    trackAction('flight_plan_opened', {
      plan_id: plan.id,
      status: plan.status,
      flight_rules: plan.flightRules,
      from: 'flight_plans_list',
    });
    router.push(('/(auth)/flight-plans/' + plan.id) as never);
  };

  const rulesLabel = (plan: FlightPlan): string =>
    t('flightRules.' + plan.flightRules, { defaultValue: plan.flightRules });

  const statusLabel = (plan: FlightPlan): string =>
    plan.status === 'COMPLETED' ? t('vfr.completed') : t('vfr.draft');

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center bg-background" testID="plans-loading">
        <Spinner size="lg" />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-background" testID="plans-list">
      {/* ── PAGE HEADER ───────────────────────────────────────── */}
      <View
        className={
          'border-b-2 border-rule ' +
          pad +
          (isDesktop ? ' flex-row items-end justify-between py-6' : ' py-5')
        }
      >
        <View style={{ minWidth: 0 }}>
          <Text variant="kicker">
            {t('plans.kicker', { count: plans.length, drafts: draftCount })}
          </Text>
          <Text variant={isDesktop ? 'h1' : 'h2'} className="mt-2">
            {t('nav.flightPlans')}
          </Text>
        </View>
        <View className={isDesktop ? '' : 'mt-4 flex-row'}>
          <Button
            testID="new-flight-plan"
            onPress={() => {
              trackAction('cta_clicked', { cta: 'new_flight_plan', from: 'flight_plans_list' });
              router.push('/(auth)/flight-plans/new' as never);
            }}
          >
            <Text>{t('dashboard.newPlan')}</Text>
          </Button>
        </View>
      </View>

      {/* ── FILTERS ───────────────────────────────────────────── */}
      <View className={'flex-row flex-wrap border-b border-border py-3 ' + pad}>
        {FILTERS.map((f) => {
          const active = filter === f.id;
          return (
            <Pressable
              key={f.id}
              onPress={() => setFilter(f.id)}
              testID={'plans-filter-' + f.id}
              className={['border-2 border-rule px-3 py-2', active ? 'bg-rule' : 'bg-transparent'].join(' ')}
              style={{ marginRight: -2 }}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
            >
              <Text variant="labelInk" className={active ? 'text-background' : 'text-foreground'}>
                {t(f.key)}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {visible.length === 0 ? (
        <View className={'py-16 ' + pad} testID="plans-empty">
          <Text variant={isDesktop ? 'h3' : 'h4'} style={{ maxWidth: 460 }}>
            {plans.length === 0 ? t('dashboard.noPlansYet') : t('plans.noneInFilter')}
          </Text>
          {plans.length === 0 ? (
            <View className="mt-6 flex-row">
              <Button onPress={() => router.push('/(auth)/flight-plans/new' as never)}>
                <Text>{t('dashboard.newPlan')}</Text>
              </Button>
            </View>
          ) : null}
        </View>
      ) : (
        <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 32 }}>
          {/* Column headings — desktop only; the mobile rows are self-labelling. */}
          {isDesktop ? (
            <View className={'flex-row items-center border-b-2 border-rule py-2 ' + pad}>
              <View style={{ flexBasis: '34%', flexGrow: 0, minWidth: 0 }}>
                <Text variant="label">{t('plans.colRoute')}</Text>
              </View>
              <View style={{ flexBasis: '22%', flexGrow: 0, minWidth: 0 }}>
                <Text variant="label">{t('ops.departure')}</Text>
              </View>
              <View style={{ flexBasis: '12%', flexGrow: 0, minWidth: 0 }}>
                <Text variant="label">{t('plans.colDist')}</Text>
              </View>
              <View style={{ flexBasis: '12%', flexGrow: 0, minWidth: 0 }}>
                <Text variant="label">{t('plans.colEte')}</Text>
              </View>
              <View style={{ flexBasis: '10%', flexGrow: 0, minWidth: 0 }}>
                <Text variant="label">{t('ops.rules')}</Text>
              </View>
              <View style={{ flexBasis: '10%', flexGrow: 1, minWidth: 0 }}>
                <Text variant="label">{t('plans.colStatus')}</Text>
              </View>
            </View>
          ) : null}

          {visible.map((plan) =>
            isDesktop ? (
              <Pressable
                key={plan.id}
                onPress={() => open(plan)}
                testID={'plan-row-' + plan.id}
                className={'flex-row items-center border-b border-border py-4 hover:bg-secondary ' + pad}
              >
                <View style={{ flexBasis: '34%', flexGrow: 0, minWidth: 0, paddingRight: 12 }}>
                  <Text variant="large">
                    {plan.originIcao + ' → ' + plan.destinationIcao}
                    {plan.alternateIcao ? ' / ' + plan.alternateIcao : ''}
                  </Text>
                  <Text variant="muted" className="mt-1 text-[12px]" numberOfLines={1}>
                    {plan.originName + ' — ' + plan.destinationName}
                  </Text>
                </View>
                <View style={{ flexBasis: '22%', flexGrow: 0, minWidth: 0, paddingRight: 12 }}>
                  <Text variant="small">{formatZulu(plan.plannedDepartureUtc)}</Text>
                </View>
                <View style={{ flexBasis: '12%', flexGrow: 0, minWidth: 0 }}>
                  <Text variant="small">
                    {plan.totalDistanceNm !== null && plan.totalDistanceNm !== undefined
                      ? plan.totalDistanceNm.toFixed(1) + ' NM'
                      : '—'}
                  </Text>
                </View>
                <View style={{ flexBasis: '12%', flexGrow: 0, minWidth: 0 }}>
                  <Text variant="small">{formatDuration(plan.estimatedElapsedMin)}</Text>
                </View>
                <View style={{ flexBasis: '10%', flexGrow: 0, minWidth: 0 }}>
                  <Text variant="labelInk">{rulesLabel(plan)}</Text>
                </View>
                <View style={{ flexBasis: '10%', flexGrow: 1, minWidth: 0 }}>
                  <Text
                    variant="labelInk"
                    className={plan.status === 'COMPLETED' ? 'text-success' : 'text-muted-foreground'}
                  >
                    {statusLabel(plan)}
                  </Text>
                </View>
              </Pressable>
            ) : (
              <Pressable
                key={plan.id}
                onPress={() => open(plan)}
                testID={'plan-row-' + plan.id}
                className={'border-b-2 border-border py-4 ' + pad}
              >
                <View className="flex-row items-center justify-between gap-3">
                  <Text variant="h4" numberOfLines={1} style={{ flexShrink: 1 }}>
                    {plan.originIcao + ' → ' + plan.destinationIcao}
                  </Text>
                  <Text
                    variant="labelInk"
                    className={plan.status === 'COMPLETED' ? 'text-success' : 'text-muted-foreground'}
                  >
                    {statusLabel(plan)}
                  </Text>
                </View>
                <Text variant="muted" className="mt-1 text-[12px]" numberOfLines={1}>
                  {plan.originName + ' — ' + plan.destinationName}
                </Text>
                <View className="mt-3 flex-row border-t-2 border-rule">
                  {[
                    {
                      key: 'dist',
                      label: t('plans.colDist'),
                      value:
                        plan.totalDistanceNm !== null && plan.totalDistanceNm !== undefined
                          ? plan.totalDistanceNm.toFixed(1)
                          : '—',
                    },
                    {
                      key: 'ete',
                      label: t('plans.colEte'),
                      value: formatDuration(plan.estimatedElapsedMin),
                    },
                    { key: 'rules', label: t('ops.rules'), value: rulesLabel(plan) },
                    {
                      key: 'alt',
                      label: t('readiness.alternate.label'),
                      value: plan.alternateIcao ?? '—',
                    },
                  ].map((cell) => (
                    <View
                      key={cell.key}
                      className="border-r border-border pr-2 pt-2"
                      style={{ flex: 1, minWidth: 0 }}
                    >
                      <Text variant="label" className="text-[10px]">
                        {cell.label}
                      </Text>
                      <Text variant="small" className="mt-1" numberOfLines={1}>
                        {cell.value}
                      </Text>
                    </View>
                  ))}
                </View>
              </Pressable>
            ),
          )}
        </ScrollView>
      )}
    </View>
  );
}
