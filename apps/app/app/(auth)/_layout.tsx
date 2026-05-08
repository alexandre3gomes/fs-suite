import { Redirect, Stack } from 'expo-router';

import { useAuthStore } from '../../src/stores/auth.store';

export default function AuthLayout(): JSX.Element {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  if (!isAuthenticated) {
    return <Redirect href="/(public)/login" />;
  }

  return <Stack screenOptions={{ headerShown: false }} />;
}
