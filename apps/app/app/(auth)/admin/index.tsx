import { Card, CardContent, Spinner, Text } from '@fs-suite/ui';
import { Redirect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { useCurrentUser } from '../../../src/hooks/useCurrentUser';
import { notify } from '../../../src/lib/notify';
import { audienceAdminApi } from '../../../src/services/audience-admin.service';

export default function AdminScreen(): JSX.Element {
  const { t } = useTranslation();
  const router = useRouter();
  const { user, isLoading } = useCurrentUser();
  const [syncing, setSyncing] = useState(false);

  const syncAudience = useCallback(async () => {
    setSyncing(true);
    try {
      const r = await audienceAdminApi.sync();
      notify(
        t('admin.audienceSyncCard'),
        t('admin.audienceSyncDone', { ok: r.ok, total: r.total, failed: r.failed }),
      );
    } catch {
      notify(t('common.error'), t('admin.audienceSyncError'));
    } finally {
      setSyncing(false);
    }
  }, [t]);

  if (isLoading && !user) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <Spinner size="lg" />
      </View>
    );
  }
  // Gate: only admins (persisted flag with ADMIN_EMAILS bootstrap fallback).
  if (user && !user.isAdmin) {
    return <Redirect href="/(auth)/dashboard" />;
  }

  return (
    <View className="flex-1 bg-background">
      <View className="flex-1 px-4 py-6 md:mx-auto md:w-full md:max-w-3xl md:px-8 md:py-10">
        <Text variant="h3" className="mb-6">
          {t('admin.title')}
        </Text>

        <View className="gap-3">
          <Card className="active:opacity-80">
            <Pressable onPress={() => router.push('/(auth)/admin/users')}>
              <CardContent className="md:px-8 md:py-6">
                <Text className="text-base font-bold md:text-lg">{t('admin.usersCard')}</Text>
                <Text variant="muted" className="mt-1">{t('admin.usersCardDesc')}</Text>
              </CardContent>
            </Pressable>
          </Card>

          <Card className="active:opacity-80">
            <Pressable onPress={() => router.push('/(auth)/admin/feedback')}>
              <CardContent className="md:px-8 md:py-6">
                <Text className="text-base font-bold md:text-lg">{t('admin.feedbackCard')}</Text>
                <Text variant="muted" className="mt-1">{t('admin.feedbackCardDesc')}</Text>
              </CardContent>
            </Pressable>
          </Card>

          <Card className={syncing ? 'opacity-60' : 'active:opacity-80'}>
            <Pressable
              onPress={() => {
                if (!syncing) void syncAudience();
              }}
              disabled={syncing}
            >
              <CardContent className="md:px-8 md:py-6">
                <View className="flex-row items-center justify-between gap-2">
                  <Text className="text-base font-bold md:text-lg">
                    {t('admin.audienceSyncCard')}
                  </Text>
                  {syncing ? <Spinner size="sm" /> : null}
                </View>
                <Text variant="muted" className="mt-1">{t('admin.audienceSyncDesc')}</Text>
              </CardContent>
            </Pressable>
          </Card>
        </View>
      </View>
    </View>
  );
}
