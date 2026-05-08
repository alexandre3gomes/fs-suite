import { Redirect } from 'expo-router';

import { useAuthStore } from '../src/stores/auth.store';

export default function Index() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  if (isAuthenticated) {
    return <Redirect href="/(auth)/dashboard" />;
  }

  return <Redirect href="/(public)/login" />;
}
