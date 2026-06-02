import { Card, CardContent, Spinner, Text } from '@fs-suite/ui';
import { Redirect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, ScrollView, View } from 'react-native';

import { useCurrentUser } from '../../../../src/hooks/useCurrentUser';
import {
  feedbackApi,
  type AdminFeedbackSummary,
  type FeedbackStatus,
} from '../../../../src/services/feedback.service';

const STATUS_STYLES: Record<FeedbackStatus, string> = {
  OPEN: 'bg-amber-500/15 text-amber-600',
  ANSWERED: 'bg-primary/15 text-primary',
  RESOLVED: 'bg-emerald-500/15 text-emerald-600',
};

export default function AdminFeedbackScreen(): JSX.Element {
  const { t } = useTranslation();
  const router = useRouter();
  const { user: me } = useCurrentUser();

  const [items, setItems] = useState<AdminFeedbackSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<FeedbackStatus | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await feedbackApi.listAdmin(statusFilter ? { status: statusFilter } : undefined));
    } catch {
      Alert.alert(t('common.error'), t('admin.feedback.loadError'));
    } finally {
      setLoading(false);
    }
  }, [t, statusFilter]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (me && !me.isAdmin) {
    return <Redirect href="/(auth)/dashboard" />;
  }

  return (
    <ScrollView className="flex-1 bg-background" contentContainerStyle={{ paddingBottom: 48 }}>
      <View className="px-4 py-6 md:mx-auto md:w-full md:max-w-3xl md:px-8 md:py-10">
        <Text variant="h3" className="mb-4">
          {t('admin.feedback.title')}
        </Text>

        <View className="mb-4 flex-row flex-wrap gap-2">
          {([null, 'OPEN', 'ANSWERED', 'RESOLVED'] as const).map((s) => {
            const active = statusFilter === s;
            return (
              <Pressable
                key={s ?? 'ALL'}
                onPress={() => setStatusFilter(s)}
                className={`rounded-full border px-3 py-1 ${
                  active ? 'border-primary bg-primary/10' : 'border-border'
                }`}
              >
                <Text
                  className={`text-xs ${active ? 'font-medium text-primary' : 'text-muted-foreground'}`}
                >
                  {s ? t(`admin.feedback.status.${s}`) : t('admin.feedback.filterAll')}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {loading ? (
          <Spinner />
        ) : items.length === 0 ? (
          <Text variant="muted" className="text-xs">
            {t('admin.feedback.empty')}
          </Text>
        ) : (
          <View className="gap-2">
            {items.map((f) => (
              <Card key={f.id} className="active:opacity-80">
                <Pressable onPress={() => router.push(`/(auth)/admin/feedback/${f.id}`)}>
                  <CardContent className="md:px-6 md:py-4">
                    <View className="flex-row items-center justify-between gap-3">
                      <View className="flex-1">
                        <View className="flex-row items-center gap-2">
                          <Text className="text-sm font-semibold text-foreground">
                            {f.type === 'BUG_REPORT'
                              ? t('feedback.typeBug')
                              : t('feedback.typeSuggestion')}
                          </Text>
                          {f.attachmentCount > 0 ? (
                            <Text variant="muted" className="text-[11px]">
                              📎 {f.attachmentCount}
                            </Text>
                          ) : null}
                        </View>
                        <Text variant="muted" className="mt-0.5 text-[11px]" numberOfLines={1}>
                          {f.reporterName} · {f.reporterEmail}
                        </Text>
                        <Text className="mt-1 text-xs text-foreground" numberOfLines={2}>
                          {f.description}
                        </Text>
                        <Text variant="muted" className="mt-1 text-[11px]">
                          {new Date(f.createdAt).toLocaleString()}
                        </Text>
                      </View>
                      <View className={`rounded-full px-2 py-0.5 ${STATUS_STYLES[f.status]}`}>
                        <Text className={`text-[10px] font-medium ${STATUS_STYLES[f.status]}`}>
                          {t(`admin.feedback.status.${f.status}`)}
                        </Text>
                      </View>
                    </View>
                  </CardContent>
                </Pressable>
              </Card>
            ))}
          </View>
        )}
      </View>
    </ScrollView>
  );
}
