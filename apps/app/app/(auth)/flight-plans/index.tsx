import { Link } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ScrollView, View, Text, Pressable } from 'react-native';

export default function FlightPlansScreen() {
  const { t } = useTranslation();

  return (
    <ScrollView className="flex-1 bg-background">
      <View className="px-4 py-6">
        <View className="mb-6 flex-row items-center justify-between">
          <Text className="text-2xl font-bold text-foreground">{t('flightPlans.title')}</Text>
          <Link href="/(auth)/flight-plans/new" asChild>
            <Pressable className="rounded-button bg-primary px-4 py-2">
              <Text className="font-medium text-primary-foreground">{t('flightPlans.newPlan')}</Text>
            </Pressable>
          </Link>
        </View>

        {/* TODO: Phase 3 — List flight plans from API */}
        <Text className="text-center text-muted-foreground">{t('flightPlans.noPlan')}</Text>
      </View>
    </ScrollView>
  );
}
