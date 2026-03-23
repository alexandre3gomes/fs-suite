import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ScrollView, View, Text, Pressable } from 'react-native';

export default function FlightPlanDetailScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();

  return (
    <ScrollView className="flex-1 bg-background">
      <View className="px-4 py-6">
        <View className="mb-6 flex-row items-center gap-3">
          <Pressable onPress={() => router.back()}>
            <Text className="text-primary">{t('common.back')}</Text>
          </Pressable>
          <Text className="text-2xl font-bold text-foreground">{t('flightPlans.title')}</Text>
        </View>

        {/* TODO: Phase 3 — Load flight plan detail by id */}
        <Text className="text-muted-foreground">Plan ID: {id}</Text>
      </View>
    </ScrollView>
  );
}
