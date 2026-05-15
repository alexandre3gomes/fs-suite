import { Redirect, Stack } from 'expo-router';
import { View } from 'react-native';

import { AppHeader } from '../../src/components/AppHeader';
import { useAuthStore } from '../../src/stores/auth.store';

export default function AuthLayout(): JSX.Element {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  if (!isAuthenticated) {
    return <Redirect href="/(public)/login" />;
  }

  return (
    <View style={{ flex: 1 }}>
      <AppHeader />
      <Stack screenOptions={{ headerShown: false }} />
    </View>
  );
}
