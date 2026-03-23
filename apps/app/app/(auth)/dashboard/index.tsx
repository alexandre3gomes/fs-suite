import { useTranslation } from 'react-i18next';
import { ScrollView, View, Text } from 'react-native';

export default function DashboardScreen() {
  const { t } = useTranslation();

  return (
    <ScrollView className="flex-1 bg-background">
      <View className="px-4 py-6">
        <Text className="mb-6 text-2xl font-bold text-foreground">{t('dashboard.title')}</Text>

        {/* TODO: Phase 2 — Module cards (Flight Planning, SimBrief, SkyVector) */}
        <View className="rounded-card border border-border bg-surface p-4">
          <Text className="text-foreground">{t('dashboard.flightPlans')}</Text>
        </View>
      </View>
    </ScrollView>
  );
}
