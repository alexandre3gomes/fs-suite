import { Badge, Card, Spinner } from '@fs-suite/ui';
import { Link, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, Text, View } from 'react-native';

import { apiClient } from '../../../src/services/api.client';

interface FlightPlanItem {
  id: string;
  status: string;
  flightType: string;
  originIcao: string;
  destinationIcao: string;
  plannedAltitude: number | null;
  createdAt: string;
  updatedAt: string;
  origin?: { icao: string; name: string; city: string | null };
  destination?: { icao: string; name: string; city: string | null };
}

interface PaginatedResponse {
  items: FlightPlanItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export default function FlightPlansScreen() {
  const { t } = useTranslation();
  const [data, setData] = useState<PaginatedResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  const fetchPlans = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const result = await apiClient.get<PaginatedResponse>(`/flight-plans?page=${p}&limit=20`);
      setData(result);
      setPage(p);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void fetchPlans(1);
    }, [fetchPlans]),
  );

  const statusVariant = (status: string) => {
    switch (status) {
      case 'SAVED': return 'success' as const;
      case 'ARCHIVED': return 'outline' as const;
      default: return 'default' as const;
    }
  };

  const renderItem = ({ item }: { item: FlightPlanItem }) => (
    <Link href={`/(auth)/flight-plans/${item.id}` as never} asChild>
      <Pressable className="mb-3">
        <Card className="p-4">
          <View className="flex-row items-center justify-between">
            <View className="flex-1">
              <Text className="text-lg font-semibold text-foreground">
                {item.originIcao} → {item.destinationIcao}
              </Text>
              <Text className="mt-0.5 text-sm text-muted-foreground">
                {item.origin?.name ?? item.originIcao} — {item.destination?.name ?? item.destinationIcao}
              </Text>
            </View>
            <View className="items-end gap-1">
              <Badge variant={statusVariant(item.status)}>{item.status}</Badge>
              <Badge variant="outline">{item.flightType}</Badge>
            </View>
          </View>
          <Text className="mt-2 text-xs text-muted-foreground">
            {new Date(item.updatedAt).toLocaleDateString()}
          </Text>
        </Card>
      </Pressable>
    </Link>
  );

  if (loading && !data) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <Spinner size="lg" />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-background">
      <View className="flex-row items-center justify-between border-b border-border px-4 py-3">
        <Text className="text-2xl font-bold text-foreground">{t('flightPlans.title')}</Text>
        <Link href="/(auth)/flight-plans/new" asChild>
          <Pressable className="rounded-button bg-primary px-4 py-2">
            <Text className="font-medium text-primary-foreground">{t('flightPlans.newPlan')}</Text>
          </Pressable>
        </Link>
      </View>

      {data && data.items.length > 0 ? (
        <FlatList
          data={data.items}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          contentContainerClassName="p-4"
          onEndReached={() => {
            if (data && page < data.totalPages) {
              void fetchPlans(page + 1);
            }
          }}
          onEndReachedThreshold={0.5}
        />
      ) : (
        <View className="flex-1 items-center justify-center px-4">
          <Text className="text-center text-muted-foreground">{t('flightPlans.noPlan')}</Text>
        </View>
      )}
    </View>
  );
}
