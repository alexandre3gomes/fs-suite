import { Spinner } from '@fs-suite/ui';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { trackAction, setFeatureContext } from '../../../src/services/analytics';
import { apiClient } from '../../../src/services/api.client';

interface FlightPlanSummary {
  id: string;
  status: string;
  flightRules: string;
  originIcao: string;
  originName: string;
  destinationIcao: string;
  destinationName: string;
  alternateIcao: string | null;
  createdAt: string;
  updatedAt: string;
}

export default function VfrPlansListScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const [plans, setPlans] = useState<FlightPlanSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchPlans = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiClient.get<FlightPlanSummary[]>('/flight-plans');
      setPlans(data);
      trackAction('flight_plan_list_viewed', { plan_count: data.length, is_empty: data.length === 0 });
    } catch {
      setPlans([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { setFeatureContext('flight_plans'); return () => setFeatureContext(null); }, []);

  // Refetch whenever the screen gains focus (e.g., after coming back from editor)
  useFocusEffect(useCallback(() => { void fetchPlans(); }, [fetchPlans]));

  return (
    <View className="flex-1 bg-background">
      <View className="flex-1 md:mx-auto md:w-full md:max-w-4xl">
        {loading ? (
          <View className="flex-1 items-center justify-center">
            <Spinner size="lg" />
          </View>
        ) : (
          <ScrollView className="flex-1" contentContainerStyle={{ padding: 16 }}>
            {/* New plan button */}
            <Pressable
              className="mb-4 rounded-card border-2 border-dashed border-primary/30 bg-primary/5 p-4 active:opacity-80 md:p-6"
              onPress={() => {
                trackAction('cta_clicked', { cta: 'new_flight_plan', from: 'flight_plans_list' });
                router.push('/(auth)/flight-plans/new');
              }}
            >
              <Text className="text-center text-base font-bold text-primary md:text-lg">
                + {t('dashboard.newPlan')}
              </Text>
            </Pressable>

            {plans.length === 0 ? (
              <View className="items-center py-10">
                <Text className="text-center text-sm text-muted-foreground">
                  {t('dashboard.noPlansYet')}
                </Text>
              </View>
            ) : (
              <View className="md:flex-row md:flex-wrap md:gap-4">
                {plans.map((plan) => (
                  <Pressable
                    key={plan.id}
                    className="mb-3 rounded-card border border-border bg-surface p-4 active:opacity-80 md:mb-0 md:w-[calc(50%-8px)] md:p-5"
                    onPress={() => {
                      trackAction('flight_plan_opened', {
                        plan_id: plan.id,
                        status: plan.status,
                        flight_rules: plan.flightRules,
                        from: 'flight_plans_list',
                      });
                      router.push(`/(auth)/flight-plans/${plan.id}`);
                    }}
                  >
                    <View className="flex-row items-center justify-between">
                      <View className="flex-row items-center gap-2">
                        <View className="rounded bg-primary/10 px-1.5 py-0.5">
                          <Text className="text-[10px] font-bold text-primary">
                            {(plan.flightRules ?? 'VFR').replace('_', '→')}
                          </Text>
                        </View>
                        <Text className="text-sm font-bold text-foreground">
                          {plan.originIcao} → {plan.destinationIcao}
                          {plan.alternateIcao ? ` (alt: ${plan.alternateIcao})` : ''}
                        </Text>
                      </View>
                      <View
                        className={`rounded-full px-2 py-0.5 ${plan.status === 'COMPLETED' ? 'bg-success/10' : 'bg-muted'}`}
                      >
                        <Text
                          className={`text-xs font-medium ${plan.status === 'COMPLETED' ? 'text-success' : 'text-muted-foreground'}`}
                        >
                          {plan.status === 'COMPLETED' ? t('vfr.completed') : t('vfr.draft')}
                        </Text>
                      </View>
                    </View>
                    <Text className="mt-1 text-xs text-muted-foreground" numberOfLines={1}>
                      {plan.originName} → {plan.destinationName}
                    </Text>
                    <Text className="mt-1 text-xs text-muted-foreground">
                      {new Date(plan.updatedAt).toLocaleDateString()}
                    </Text>
                  </Pressable>
                ))}
              </View>
            )}
          </ScrollView>
        )}
      </View>
    </View>
  );
}
