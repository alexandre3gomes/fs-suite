import { Card, CardContent, Spinner, Text } from '@fs-suite/ui';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { useCurrentUser } from '../../../src/hooks/useCurrentUser';
import { trackAction } from '../../../src/services/analytics';

export default function DashboardScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { user, isLoading } = useCurrentUser();

  if (isLoading && !user) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <Spinner size="lg" />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-background">
      <View className="flex-1 px-4 py-6 md:mx-auto md:w-full md:max-w-3xl md:px-8 md:py-10">
        <Text variant="h3" className="mb-6">
          {t('dashboard.welcome')}
        </Text>

        <View className="gap-3">
          <Card className="active:opacity-80">
            <Pressable onPress={() => {
              trackAction('cta_clicked', { cta: 'flight_planning', from: 'dashboard' });
              router.push('/(auth)/flight-plans');
            }}>
              <CardContent className="md:px-8 md:py-6">
                <Text className="text-base font-bold md:text-lg">
                  {t('dashboard.flightPlanning')}
                </Text>
                <Text variant="muted" className="mt-1">
                  {t('dashboard.flightPlanningDesc')}
                </Text>
              </CardContent>
            </Pressable>
          </Card>

          <Card className="active:opacity-80">
            <Pressable onPress={() => {
              trackAction('cta_clicked', { cta: 'aircraft_profiles', from: 'dashboard' });
              router.push('/(auth)/aircraft-profiles');
            }}>
              <CardContent className="md:px-8 md:py-6">
                <Text className="text-base font-bold md:text-lg">
                  {t('dashboard.aircraftProfiles')}
                </Text>
                <Text variant="muted" className="mt-1">
                  {t('dashboard.aircraftProfilesDesc')}
                </Text>
              </CardContent>
            </Pressable>
          </Card>
        </View>
      </View>
    </View>
  );
}
