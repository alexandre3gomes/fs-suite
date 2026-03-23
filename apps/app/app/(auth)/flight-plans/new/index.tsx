import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ScrollView, View, Text, Pressable } from 'react-native';

export default function NewFlightPlanScreen() {
  const { t } = useTranslation();

  return (
    <ScrollView className="flex-1 bg-background">
      <View className="px-4 py-6">
        <View className="mb-6 flex-row items-center gap-3">
          <Pressable onPress={() => router.back()}>
            <Text className="text-primary">{t('common.back')}</Text>
          </Pressable>
          <Text className="text-2xl font-bold text-foreground">{t('flightPlans.newPlan')}</Text>
        </View>

        {/* TODO: Phase 3 — Flight plan form (origin, destination, aircraft, type, route) */}
        <View className="gap-4">
          <Text className="text-muted-foreground">{t('flightPlans.origin')}</Text>
          <Text className="text-muted-foreground">{t('flightPlans.destination')}</Text>
          <Text className="text-muted-foreground">{t('flightPlans.aircraft')}</Text>
          <Text className="text-muted-foreground">{t('flightPlans.flightType')}</Text>
        </View>

        <Pressable className="mt-8 rounded-button bg-primary px-6 py-3">
          <Text className="text-center font-medium text-primary-foreground">{t('flightPlans.save')}</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}
