import { Spinner, Text } from '@fs-suite/ui';
import { Redirect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';

import { useCurrentUser } from '../../../../src/hooks/useCurrentUser';
import { useIsDesktop } from '../../../../src/hooks/useIsDesktop';
import { notify } from '../../../../src/lib/notify';
import {
  feedbackApi,
  type AdminFeedbackSummary,
  type FeedbackStatus,
} from '../../../../src/services/feedback.service';

/**
 * Workflow states, not aeronautical signals — so they take ink, accent and
 * success rather than a new amber token. OPEN is the one that needs a human,
 * so it reads as ink; the other two are settled.
 */
const STATUS_TEXT: Record<FeedbackStatus, string> = {
  OPEN: 'text-foreground',
  ANSWERED: 'text-accent',
  RESOLVED: 'text-success',
};

const STATUS_BAR: Record<FeedbackStatus, string> = {
  OPEN: 'bg-rule',
  ANSWERED: 'bg-primary',
  RESOLVED: 'bg-success',
};

export default function AdminFeedbackScreen(): JSX.Element {
  const { t } = useTranslation();
  const router = useRouter();
  const isDesktop = useIsDesktop();
  const { user: me } = useCurrentUser();

  const [items, setItems] = useState<AdminFeedbackSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<FeedbackStatus | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await feedbackApi.listAdmin(statusFilter ? { status: statusFilter } : undefined));
    } catch {
      notify(t('common.error'), t('admin.feedback.loadError'));
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

  const pad = isDesktop ? 'px-8' : 'px-4';
  const openCount = items.filter((f) => f.status === 'OPEN').length;

  return (
    <View className="flex-1 bg-background" testID="admin-feedback">
      <View className={'border-b-2 border-rule py-6 ' + pad}>
        <Text variant="kicker">
          {t('admin.feedback.kicker', { count: items.length, open: openCount })}
        </Text>
        <Text variant={isDesktop ? 'h1' : 'h2'} className="mt-2">
          {t('admin.feedback.title')}
        </Text>
      </View>

      <View className={'flex-row flex-wrap border-b border-border py-3 ' + pad}>
        {([null, 'OPEN', 'ANSWERED', 'RESOLVED'] as const).map((s) => {
          const active = statusFilter === s;
          return (
            <Pressable
              key={s ?? 'ALL'}
              onPress={() => setStatusFilter(s)}
              testID={'feedback-filter-' + (s ?? 'ALL')}
              className={['border-2 border-rule px-3 py-2', active ? 'bg-rule' : 'bg-transparent'].join(' ')}
              style={{ marginRight: -2 }}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
            >
              <Text variant="labelInk" className={active ? 'text-background' : 'text-foreground'}>
                {s ? t('admin.feedback.status.' + s) : t('admin.feedback.filterAll')}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <Spinner size="lg" />
        </View>
      ) : items.length === 0 ? (
        <View className={'py-16 ' + pad}>
          <Text variant={isDesktop ? 'h3' : 'h4'}>{t('admin.feedback.empty')}</Text>
        </View>
      ) : (
        <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 48 }}>
          {items.map((f) => (
            <Pressable
              key={f.id}
              testID={'feedback-row-' + f.id}
              onPress={() => router.push(('/(auth)/admin/feedback/' + f.id) as never)}
              className={'flex-row gap-4 border-b border-border py-4 ' + pad}
            >
              {/* Status reads as a bar in the gutter, before any text. */}
              <View style={{ width: 4, alignSelf: 'stretch' }} className={STATUS_BAR[f.status]} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <View className="flex-row items-baseline justify-between gap-3">
                  <Text variant="labelInk" numberOfLines={1} style={{ flexShrink: 1 }}>
                    {f.type === 'BUG_REPORT' ? t('feedback.typeBug') : t('feedback.typeSuggestion')}
                  </Text>
                  <Text variant="labelInk" className={STATUS_TEXT[f.status]}>
                    {t('admin.feedback.status.' + f.status)}
                  </Text>
                </View>
                <Text variant="small" className="mt-2" numberOfLines={2}>
                  {f.description}
                </Text>
                <View className="mt-3 flex-row flex-wrap items-center gap-x-4 gap-y-1">
                  <Text variant="muted" className="text-[11px]" numberOfLines={1}>
                    {f.reporterName + ' · ' + f.reporterEmail}
                  </Text>
                  <Text variant="muted" className="text-[11px]">
                    {new Date(f.createdAt).toLocaleString()}
                  </Text>
                  {f.attachmentCount > 0 ? (
                    <Text variant="label" className="text-[10px]">
                      {t('admin.feedback.attachmentCount', { count: f.attachmentCount })}
                    </Text>
                  ) : null}
                </View>
              </View>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  );
}
