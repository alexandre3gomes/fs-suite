import { Feather } from '@expo/vector-icons';
import { Button, Card, CardContent, Spinner, Text } from '@fs-suite/ui';
import { Redirect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';

import { useCurrentUser } from '../../../src/hooks/useCurrentUser';
import { notify } from '../../../src/lib/notify';
import { usersAdminApi, type AdminUser } from '../../../src/services/users-admin.service';

export default function AdminUsersScreen(): JSX.Element {
  const { t } = useTranslation();
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

  return (
    <ScrollView className="flex-1 bg-background" contentContainerStyle={{ paddingBottom: 48 }}>
      <View className="px-4 py-6 md:mx-auto md:w-full md:max-w-3xl md:px-8 md:py-10">
        <Text variant="h3" className="mb-6">
          {t('admin.users.title')}
        </Text>

        {loading ? (
          <Spinner />
        ) : users.length === 0 ? (
          <Text variant="muted" className="text-xs">
            {t('admin.users.empty')}
          </Text>
        ) : (
          <View className="gap-2">
            {users.map((u) => {
              const isSelf = u.id === me?.id;
              const busy = busyId === u.id;
              return (
                <Card key={u.id}>
                  <CardContent className="md:px-6 md:py-4">
                    <View className="flex-row items-center justify-between gap-3">
                      <View className="flex-1">
                        <View className="flex-row items-center gap-2">
                          <Text className="flex-shrink text-sm font-semibold text-foreground" numberOfLines={1}>
                            {u.name}
                          </Text>
                          {u.isAdmin ? (
                            <View className="rounded-full bg-primary/15 px-2 py-0.5">
                              <Text className="text-[10px] font-medium text-primary">
                                {t('admin.users.adminBadge')}
                              </Text>
                            </View>
                          ) : null}
                          {isSelf ? (
                            <View className="rounded-full bg-surface-muted px-2 py-0.5">
                              <Text className="text-[10px] font-medium text-muted-foreground">
                                {t('admin.users.you')}
                              </Text>
                            </View>
                          ) : null}
                        </View>
                        <Text variant="muted" className="mt-0.5 text-[11px]" numberOfLines={1}>
                          {u.email}
                        </Text>
                        <Text variant="muted" className="mt-0.5 text-[11px]">
                          {new Date(u.createdAt).toLocaleDateString()}
                        </Text>
                      </View>

                      <View className="flex-row items-center gap-2">
                        <Button
                          variant={u.isAdmin ? 'ghost' : 'outline'}
                          size="sm"
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
                          <View className="flex-row items-center gap-1">
                            <Button
                              variant="destructive"
                              size="sm"
                              onPress={() => {
                                void remove(u);
                              }}
                              disabled={busy}
                            >
                              <Text>{t('admin.users.confirmDelete')}</Text>
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onPress={() => setConfirmingDelete(null)}
                              disabled={busy}
                            >
                              <Text>{t('common.cancel')}</Text>
                            </Button>
                          </View>
                        ) : (
                          <Pressable
                            onPress={() => setConfirmingDelete(u.id)}
                            disabled={busy || isSelf}
                            className={isSelf ? 'opacity-30' : 'active:opacity-60'}
                            hitSlop={8}
                          >
                            <Feather name="trash-2" size={18} color="#ef4444" />
                          </Pressable>
                        )}
                      </View>
                    </View>
                  </CardContent>
                </Card>
              );
            })}
          </View>
        )}
      </View>
    </ScrollView>
  );
}
