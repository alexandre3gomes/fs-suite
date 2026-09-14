import { Redirect, Stack } from 'expo-router';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { AppShell } from '../../src/components/nav/AppShell';
import { useCurrentUser } from '../../src/hooks/useCurrentUser';
import { apiClient } from '../../src/services/api.client';
import { useAuthStore } from '../../src/stores/auth.store';

export default function AuthLayout(): JSX.Element {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const setUser = useAuthStore((s) => s.setUser);
  const { user } = useCurrentUser();
  const { i18n } = useTranslation();

  // Keep the backend's stored locale in sync with the app language (best-effort).
  // Powers the Resend audience `language` segment. Fires on mount and on a
  // language switch, but only PATCHes when it actually differs.
  useEffect(() => {
    if (!isAuthenticated || !user) return;
    const current = i18n.language;
    if (!current || current === user.locale) return;
    void apiClient
      .patch('/users/me', { locale: current })
      .then(() => setUser({ ...user, locale: current }))
      .catch(() => undefined);
  }, [isAuthenticated, user, i18n.language, setUser]);

  if (!isAuthenticated) {
    return <Redirect href="/(public)/login" />;
  }

  // AppShell replaces AppHeader. The Stack and every route inside it are
  // unchanged — only the surrounding chrome differs.
  return (
    <AppShell>
      <Stack screenOptions={{ headerShown: false }} />
    </AppShell>
  );
}
