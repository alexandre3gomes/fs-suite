import { Spinner, Text } from '@fs-suite/ui';
import { Redirect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { useCurrentUser } from '../../../src/hooks/useCurrentUser';
import { useIsDesktop } from '../../../src/hooks/useIsDesktop';
import { notify } from '../../../src/lib/notify';
import { audienceAdminApi } from '../../../src/services/audience-admin.service';

export default function AdminScreen(): JSX.Element {
  const { t } = useTranslation();
  const router = useRouter();
  const isDesktop = useIsDesktop();
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

  const pad = isDesktop ? 'px-8' : 'px-4';

  const rows = [
    {
      key: 'users',
      title: t('admin.usersCard'),
      desc: t('admin.usersCardDesc'),
      onPress: () => router.push('/(auth)/admin/users'),
      busy: false,
    },
    {
      key: 'feedback',
      title: t('admin.feedbackCard'),
      desc: t('admin.feedbackCardDesc'),
      onPress: () => router.push('/(auth)/admin/feedback'),
      busy: false,
    },
    {
      key: 'audience',
      title: t('admin.audienceSyncCard'),
      desc: t('admin.audienceSyncDesc'),
      onPress: () => {
        if (!syncing) void syncAudience();
      },
      busy: syncing,
    },
  ];

  return (
    <View className="flex-1 bg-background">
      <View className={'border-b-2 border-rule py-6 ' + pad}>
        <Text variant="kicker">{t('admin.restricted')}</Text>
        <Text variant={isDesktop ? 'h1' : 'h2'} className="mt-2">
          {t('admin.title')}
        </Text>
      </View>

      <View>
        {rows.map((row) => (
          <Pressable
            key={row.key}
            onPress={row.onPress}
            disabled={row.busy}
            className={
              'flex-row items-center justify-between gap-4 border-b border-border py-5 ' +
              pad +
              (row.busy ? ' opacity-45' : '')
            }
          >
            <View style={{ minWidth: 0, flexShrink: 1 }}>
              <Text variant="h4">{row.title}</Text>
              <Text variant="muted" className="mt-1">
                {row.desc}
              </Text>
            </View>
            {row.busy ? <Spinner size="sm" /> : <Text variant="label">→</Text>}
          </Pressable>
        ))}
      </View>
    </View>
  );
}
