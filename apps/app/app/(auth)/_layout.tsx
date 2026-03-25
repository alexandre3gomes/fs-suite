import { Redirect, Tabs } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useAuthStore } from '../../src/stores/auth.store';

export default function AuthLayout(): JSX.Element {
  const { t } = useTranslation();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  if (!isAuthenticated) {
    return <Redirect href="/(public)/login" />;
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: '#161a24',
          borderTopColor: '#2a3048',
        },
        tabBarActiveTintColor: '#4a90e2',
        tabBarInactiveTintColor: '#8892a4',
      }}
    >
      <Tabs.Screen name="dashboard/index" options={{ title: t('dashboard.title') }} />
      <Tabs.Screen name="flight-plans/index" options={{ title: t('flightPlans.title') }} />
      <Tabs.Screen name="profile/index" options={{ title: t('profile.title') }} />
    </Tabs>
  );
}
