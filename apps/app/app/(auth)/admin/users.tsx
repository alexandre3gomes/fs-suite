import { Feather } from '@expo/vector-icons';
import { Button, Spinner, Text, colors } from '@fs-suite/ui';
import { Redirect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';

import { useCurrentUser } from '../../../src/hooks/useCurrentUser';
import { useIsDesktop } from '../../../src/hooks/useIsDesktop';
import { notify } from '../../../src/lib/notify';
import { usersAdminApi, type AdminUser } from '../../../src/services/users-admin.service';

export default function AdminUsersScreen(): JSX.Element {
  const { t } = useTranslation();
  const isDesktop = useIsDesktop();
  const { user: me } = useCurrentUser();

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setUsers(await usersAdminApi.list());
    } catch {
      notify(t('common.error'), t('admin.users.loadError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const toggleAdmin = useCallback(
    async (u: AdminUser) => {
      setBusyId(u.id);
      try {
        await usersAdminApi.setAdmin(u.id, !u.isAdmin);
        await refresh();
      } catch {
        notify(t('common.error'), t('admin.users.adminError'));
      } finally {
        setBusyId(null);
      }
    },
    [refresh, t],
  );

  const remove = useCallback(
    async (u: AdminUser) => {
      setConfirmingDelete(null);
      setBusyId(u.id);
      try {
        await usersAdminApi.remove(u.id);
        await refresh();
      } catch {
        notify(t('common.error'), t('admin.users.deleteError'));
      } finally {
        setBusyId(null);
      }
    },
    [refresh, t],
  );

  if (me && !me.isAdmin) {
    return <Redirect href="/(auth)/dashboard" />;
  }

  const pad = isDesktop ? 'px-8' : 'px-4';
  const adminCount = users.filter((u) => u.isAdmin).length;

  return (
    <View className="flex-1 bg-background" testID="admin-users">
      <View className={'border-b-2 border-rule py-6 ' + pad}>
        <Text variant="kicker">
          {t('admin.users.kicker', { count: users.length, admins: adminCount })}
        </Text>
        <Text variant={isDesktop ? 'h1' : 'h2'} className="mt-2">
          {t('admin.users.title')}
        </Text>
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <Spinner size="lg" />
        </View>
      ) : users.length === 0 ? (
        <View className={'py-16 ' + pad}>
          <Text variant={isDesktop ? 'h3' : 'h4'}>{t('admin.users.empty')}</Text>
        </View>
      ) : (
        <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 48 }}>
          {users.map((u) => {
            const isSelf = u.id === me?.id;
            const busy = busyId === u.id;
            return (
              <View
                key={u.id}
                testID={'admin-user-' + u.id}
                className={
                  'border-b border-border py-4 ' +
                  pad +
                  (isDesktop ? ' flex-row items-center justify-between gap-6' : '')
                }
              >
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View className="flex-row items-baseline gap-3">
                    <Text variant="h4" numberOfLines={1} style={{ flexShrink: 1 }}>
                      {u.name}
                    </Text>
                    {u.isAdmin ? (
                      <View className="bg-primary/15 px-2 py-1">
                        <Text variant="label" className="text-[10px] text-accent">
                          {t('admin.users.adminBadge')}
                        </Text>
                      </View>
                    ) : null}
                    {isSelf ? (
                      <View className="bg-secondary px-2 py-1">
                        <Text variant="label" className="text-[10px]">
                          {t('admin.users.you')}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                  <Text variant="muted" className="mt-1 text-[12px]" numberOfLines={1}>
                    {u.email}
                  </Text>
                  <Text variant="muted" className="mt-1 text-[11px]">
                    {new Date(u.createdAt).toLocaleDateString()}
                  </Text>
                </View>

                <View className={isDesktop ? 'flex-row items-center gap-3' : 'mt-3 flex-row items-center gap-3'}>
                  <Button
                    variant="secondary"
                    size="sm"
                    testID={'admin-toggle-' + u.id}
                    onPress={() => {
                      void toggleAdmin(u);
                    }}
                    disabled={busy || isSelf}
                  >
                    <Text>
                      {u.isAdmin ? t('admin.users.revokeAdmin') : t('admin.users.makeAdmin')}
                    </Text>
                  </Button>

                  {confirmingDelete === u.id ? (
                    <View className="flex-row items-center">
                      <Button
                        variant="destructive"
                        size="sm"
                        testID={'admin-delete-confirm-' + u.id}
                        onPress={() => {
                          void remove(u);
                        }}
                        disabled={busy}
                      >
                        <Text>{t('admin.users.confirmDelete')}</Text>
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onPress={() => setConfirmingDelete(null)}
                        disabled={busy}
                        className="border-l-0"
                      >
                        <Text>{t('common.cancel')}</Text>
                      </Button>
                    </View>
                  ) : (
                    <Pressable
                      onPress={() => setConfirmingDelete(u.id)}
                      disabled={busy || isSelf}
                      testID={'admin-delete-' + u.id}
                      className={
                        'border-2 border-rule px-3 ' + (isSelf ? 'opacity-45' : 'active:bg-secondary')
                      }
                      style={{ height: 36, justifyContent: 'center' }}
                      accessibilityRole="button"
                      accessibilityLabel={t('common.delete')}
                    >
                      <Feather name="trash-2" size={16} color={colors.destructive} />
                    </Pressable>
                  )}
                </View>
              </View>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}
