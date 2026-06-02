import { Feather } from '@expo/vector-icons';
import { Button, Card, CardContent, Spinner, Text } from '@fs-suite/ui';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Image, Platform, Pressable, ScrollView, TextInput, View } from 'react-native';

import { useCurrentUser } from '../../../../src/hooks/useCurrentUser';
import { notify } from '../../../../src/lib/notify';
import {
  feedbackApi,
  type AdminFeedbackDetail,
  type FeedbackAttachment,
} from '../../../../src/services/feedback.service';

function AttachmentPreview({
  feedbackId,
  attachment,
}: {
  feedbackId: string;
  attachment: FeedbackAttachment;
}): JSX.Element {
  const { t } = useTranslation();
  const [url, setUrl] = useState<string | null>(null);
  const isImage = attachment.contentType.startsWith('image/');

  useEffect(() => {
    let active = true;
    let created: string | null = null;
    if (isImage) {
      void feedbackApi
        .attachmentObjectUrl(feedbackId, attachment.id)
        .then((u) => {
          created = u;
          if (active) setUrl(u);
          else URL.revokeObjectURL(u);
        })
        .catch(() => undefined);
    }
    return () => {
      active = false;
      if (created) URL.revokeObjectURL(created);
    };
  }, [feedbackId, attachment.id, isImage]);

  // Click the IMAGE → open in a new tab to view (renders inline). Fetch a fresh
  // blob URL and don't revoke it, so the opened tab keeps working after this
  // card unmounts. The blob URL ignores the server's attachment disposition, so
  // the browser shows it inline.
  const open = useCallback(async () => {
    try {
      const objectUrl = await feedbackApi.attachmentObjectUrl(feedbackId, attachment.id);
      const win = (globalThis as { open?: (u: string, target?: string) => unknown }).open;
      win?.(objectUrl, '_blank');
    } catch {
      notify(t('common.error'), t('admin.feedback.attachmentError'));
    }
  }, [feedbackId, attachment.id, t]);

  // Click the FILE NAME → download.
  const download = useCallback(async () => {
    try {
      const objectUrl = await feedbackApi.attachmentObjectUrl(feedbackId, attachment.id);
      const doc = (
        globalThis as {
          document?: { createElement(tag: string): { href: string; download: string; click(): void } };
        }
      ).document;
      if (Platform.OS === 'web' && doc) {
        const a = doc.createElement('a');
        a.href = objectUrl;
        a.download = attachment.fileName;
        a.click();
        setTimeout(() => URL.revokeObjectURL(objectUrl), 4000);
      }
    } catch {
      notify(t('common.error'), t('admin.feedback.attachmentError'));
    }
  }, [feedbackId, attachment.id, attachment.fileName, t]);

  return (
    <View className="rounded-md border border-border p-2">
      {isImage && url ? (
        <Pressable
          onPress={() => {
            void open();
          }}
          style={Platform.OS === 'web' ? ({ cursor: 'zoom-in' } as never) : undefined}
        >
          <Image
            source={{ uri: url }}
            style={{ width: '100%', height: 180, borderRadius: 6 }}
            resizeMode="contain"
          />
        </Pressable>
      ) : null}
      <Pressable
        onPress={() => {
          void download();
        }}
        className="mt-2 flex-row items-center gap-2 active:opacity-70"
        style={Platform.OS === 'web' ? ({ cursor: 'pointer' } as never) : undefined}
      >
        <Feather name="download" size={14} color="#6b7280" />
        <Text className="flex-1 text-xs text-foreground" numberOfLines={1}>
          {attachment.fileName}
        </Text>
      </Pressable>
    </View>
  );
}

export default function AdminFeedbackDetailScreen(): JSX.Element {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user: me } = useCurrentUser();

  const [detail, setDetail] = useState<AdminFeedbackDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      setDetail(await feedbackApi.getAdmin(id));
    } catch {
      notify(t('common.error'), t('admin.feedback.loadError'));
    } finally {
      setLoading(false);
    }
  }, [id, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const sendReply = useCallback(async () => {
    if (!id || !reply.trim()) return;
    setBusy(true);
    try {
      const updated = await feedbackApi.reply(id, reply.trim());
      setDetail(updated);
      setReply('');
      notify(t('admin.feedback.replySentTitle'), t('admin.feedback.replySentBody'));
    } catch {
      notify(t('common.error'), t('admin.feedback.replyError'));
    } finally {
      setBusy(false);
    }
  }, [id, reply, t]);

  const toggleResolved = useCallback(async () => {
    if (!id || !detail) return;
    setBusy(true);
    try {
      const next = detail.status === 'RESOLVED' ? 'OPEN' : 'RESOLVED';
      setDetail(await feedbackApi.setStatus(id, next));
    } catch {
      notify(t('common.error'), t('admin.feedback.statusError'));
    } finally {
      setBusy(false);
    }
  }, [id, detail, t]);

  if (me && !me.isAdmin) {
    return <Redirect href="/(auth)/dashboard" />;
  }

  if (loading || !detail) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <Spinner size="lg" />
      </View>
    );
  }

  const isResolved = detail.status === 'RESOLVED';

  return (
    <ScrollView className="flex-1 bg-background" contentContainerStyle={{ paddingBottom: 48 }}>
      <View className="px-4 py-6 md:mx-auto md:w-full md:max-w-2xl md:px-8 md:py-10">
        <View className="mb-4 flex-row items-center justify-between gap-2">
          <Text variant="h3">
            {detail.type === 'BUG_REPORT' ? t('feedback.typeBug') : t('feedback.typeSuggestion')}
          </Text>
          <Text variant="muted" className="text-xs">
            {t(`admin.feedback.status.${detail.status}`)}
          </Text>
        </View>

        <Card>
          <CardContent className="gap-3">
            <View>
              <Text variant="muted" className="text-[11px]">
                {detail.reporterName} · {detail.reporterEmail}
              </Text>
              <Text variant="muted" className="text-[11px]">
                {new Date(detail.createdAt).toLocaleString()}
              </Text>
            </View>
            <Text className="text-sm text-foreground">{detail.description}</Text>

            {detail.attachments.length > 0 ? (
              <View className="gap-2">
                {detail.attachments.map((a) => (
                  <AttachmentPreview key={a.id} feedbackId={detail.id} attachment={a} />
                ))}
              </View>
            ) : null}
          </CardContent>
        </Card>

        {detail.adminReply ? (
          <Card className="mt-3">
            <CardContent className="gap-1">
              <Text className="text-[11px] font-semibold text-primary">
                {t('admin.feedback.replyHeading', { name: detail.repliedByName ?? '' })}
              </Text>
              <Text className="text-sm text-foreground">{detail.adminReply}</Text>
              {detail.repliedAt ? (
                <Text variant="muted" className="text-[11px]">
                  {new Date(detail.repliedAt).toLocaleString()}
                </Text>
              ) : null}
            </CardContent>
          </Card>
        ) : null}

        <Text className="mb-1.5 mt-6 text-sm font-medium text-foreground">
          {t('admin.feedback.replyLabel')}
        </Text>
        <TextInput
          value={reply}
          onChangeText={setReply}
          placeholder={t('admin.feedback.replyPlaceholder')}
          placeholderTextColor="hsl(220, 8.9%, 46.1%)"
          multiline
          numberOfLines={4}
          editable={!busy}
          className="min-h-[100px] rounded-md border border-input bg-background px-3 py-2.5 text-sm text-foreground"
          style={{ textAlignVertical: 'top' }}
        />

        <View className="mt-4 flex-row justify-between gap-2">
          <Button
            variant={isResolved ? 'outline' : 'secondary'}
            onPress={() => {
              void toggleResolved();
            }}
            disabled={busy}
          >
            <Text>
              {isResolved ? t('admin.feedback.reopen') : t('admin.feedback.markResolved')}
            </Text>
          </Button>
          <Button
            onPress={() => {
              void sendReply();
            }}
            disabled={busy || !reply.trim()}
          >
            {busy ? <Spinner size="sm" /> : <Text>{t('admin.feedback.sendReply')}</Text>}
          </Button>
        </View>
      </View>
    </ScrollView>
  );
}
