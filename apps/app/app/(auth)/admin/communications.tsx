import { Feather } from '@expo/vector-icons';
import { Button, Card, CardContent, Input, Select, Spinner, Text } from '@fs-suite/ui';
import { Redirect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, ScrollView, View } from 'react-native';

import { MarkdownEditor, type Picked } from '../../../src/components/admin/MarkdownEditor';
import { useCurrentUser } from '../../../src/hooks/useCurrentUser';
import {
  communicationsApi,
  type Communication,
  type CommunicationListItem,
  type SendResult,
} from '../../../src/services/communications.service';

const TYPE_OPTIONS = [{ value: 'NEW_FEATURE', label: 'Nova feature' }];

export default function CommunicationsScreen(): JSX.Element {
  const { t } = useTranslation();
  const { user } = useCurrentUser();

  const [list, setList] = useState<CommunicationListItem[]>([]);
  const [listLoading, setListLoading] = useState(true);

  const [draft, setDraft] = useState<Communication | null>(null);
  const [type, setType] = useState('NEW_FEATURE');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);
  const [sendInfo, setSendInfo] = useState<SendResult | null>(null);
  const [sending, setSending] = useState(false);
  const [confirmingSend, setConfirmingSend] = useState(false);
  // Default ON: a safety net so a stray "send" goes to admins only, not everyone.
  const [adminOnly, setAdminOnly] = useState(true);

  const refreshList = useCallback(async () => {
    setListLoading(true);
    try {
      setList(await communicationsApi.list());
    } catch {
      /* surfaced elsewhere */
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshList();
  }, [refreshList]);

  const resetForm = useCallback(() => {
    setDraft(null);
    setType('NEW_FEATURE');
    setSubject('');
    setBody('');
    setSendInfo(null);
    setConfirmingSend(false);
  }, []);

  const loadDraft = useCallback((comm: Communication) => {
    setDraft(comm);
    setType(comm.type);
    setSubject(comm.subject);
    setBody(comm.body);
    setSendInfo(null);
    setConfirmingSend(false);
  }, []);

  const handleUpload = useCallback(
    async (picked: Picked): Promise<string | null> => {
      if (!draft) {
        Alert.alert(t('admin.comm.format.image'), t('admin.comm.imageNeedDraft'));
        return null;
      }
      try {
        const { url } = await communicationsApi.uploadImage(draft.id, {
          contentType: picked.contentType,
          dataBase64: picked.dataBase64,
        });
        return url;
      } catch {
        Alert.alert(t('common.error'), t('admin.comm.uploadError'));
        return null;
      }
    },
    [draft, t],
  );

  const handlePreview = useCallback(async () => {
    if (!draft) return;
    setSending(true);
    try {
      setSendInfo(await communicationsApi.send(draft.id, true, adminOnly));
    } catch {
      Alert.alert(t('common.error'), t('admin.comm.sendError'));
    } finally {
      setSending(false);
    }
  }, [draft, adminOnly, t]);

  const handleSend = useCallback(async () => {
    if (!draft) return;
    setConfirmingSend(false);
    setSending(true);
    try {
      setSendInfo(await communicationsApi.send(draft.id, false, adminOnly));
      setDraft(await communicationsApi.get(draft.id));
      await refreshList();
    } catch {
      Alert.alert(t('common.error'), t('admin.comm.sendError'));
    } finally {
      setSending(false);
    }
  }, [draft, adminOnly, refreshList, t]);

  const handleSave = useCallback(async () => {
    if (subject.trim().length < 3 || body.trim().length < 1) {
      Alert.alert(t('common.error'), t('admin.comm.validation'));
      return;
    }
    setSaving(true);
    try {
      const saved = draft
        ? await communicationsApi.update(draft.id, { type: type as 'NEW_FEATURE', subject, body })
        : await communicationsApi.create({ type: type as 'NEW_FEATURE', subject, body });
      setDraft(saved);
      await refreshList();
    } catch {
      Alert.alert(t('common.error'), t('admin.comm.saveError'));
    } finally {
      setSaving(false);
    }
  }, [draft, type, subject, body, refreshList, t]);

  if (user && !user.isAdmin) {
    return <Redirect href="/(auth)/dashboard" />;
  }

  const isSent = draft?.status === 'SENT';

  return (
    <ScrollView className="flex-1 bg-background" contentContainerStyle={{ paddingBottom: 48 }}>
      <View className="px-4 py-6 md:mx-auto md:w-full md:max-w-3xl md:px-8 md:py-10">
        <View className="mb-6 flex-row items-center justify-between">
          <Text variant="h3">{t('admin.communications')}</Text>
          {draft ? (
            <Pressable onPress={resetForm}>
              <Text className="text-sm font-medium text-primary">{t('admin.comm.new')}</Text>
            </Pressable>
          ) : null}
        </View>

        {/* Compose / edit form */}
        <Card>
          <CardContent className="gap-4 md:px-6 md:py-6">
            <View>
              <Text variant="muted" className="mb-1.5 text-xs">{t('admin.comm.type')}</Text>
              <Select options={TYPE_OPTIONS} value={type} onValueChange={setType} />
            </View>

            <Input
              label={t('admin.comm.subject')}
              value={subject}
              onChangeText={setSubject}
              placeholder={t('admin.comm.subjectPlaceholder')}
              editable={!isSent}
            />

            <View>
              <Text variant="muted" className="mb-1.5 text-xs">{t('admin.comm.body')}</Text>
              <MarkdownEditor
                value={body}
                onChange={setBody}
                editable={!isSent}
                onUpload={handleUpload}
                placeholder={t('admin.comm.bodyPlaceholder')}
              />
              <Text variant="muted" className="mt-1 text-[11px]">{t('admin.comm.bodyHint')}</Text>
            </View>

            {!isSent ? (
              <Button onPress={() => { void handleSave(); }} disabled={saving}>
                {saving ? t('common.saving') : draft ? t('common.save') : t('admin.comm.createDraft')}
              </Button>
            ) : (
              <View className="rounded-md bg-green-500/10 px-3 py-2">
                <Text className="text-xs font-medium text-green-700">{t('admin.comm.alreadySent')}</Text>
              </View>
            )}
          </CardContent>
        </Card>

        {/* Send */}
        {draft ? (
          <Card className="mt-4">
            <CardContent className="gap-3 md:px-6 md:py-6">
              <Text className="text-base font-bold text-foreground">{t('admin.comm.send')}</Text>

              {!isSent ? (
                <Pressable onPress={() => setAdminOnly((v) => !v)} className="flex-row items-center gap-2">
                  <View
                    className={`h-5 w-5 items-center justify-center rounded border ${adminOnly ? 'border-primary bg-primary' : 'border-border'}`}
                  >
                    {adminOnly ? <Feather name="check" size={13} color="#ffffff" /> : null}
                  </View>
                  <Text className="text-xs text-foreground">{t('admin.comm.adminOnly')}</Text>
                </Pressable>
              ) : null}

              {sendInfo ? (
                <View className="rounded-md border border-border bg-surface-muted px-3 py-2">
                  <Text className="text-xs text-foreground">
                    {t('admin.comm.eligible')}: {sendInfo.eligible} · {t('admin.comm.pending')}: {sendInfo.pending} · {t('admin.comm.alreadySentCount')}: {sendInfo.alreadySent}
                  </Text>
                  {!sendInfo.dryRun ? (
                    <Text className="mt-1 text-xs font-medium text-foreground">
                      {t('admin.comm.justSent')}: {sendInfo.sent} · {t('admin.comm.failed')}: {sendInfo.failed} · {t('admin.comm.remaining')}: {sendInfo.remaining}
                    </Text>
                  ) : null}
                </View>
              ) : null}

              {!isSent ? (
                <View className="flex-row flex-wrap gap-2">
                  <Button variant="outline" size="sm" onPress={() => { void handlePreview(); }} disabled={sending}>
                    {sending ? t('common.loading') : t('admin.comm.dryRun')}
                  </Button>
                  {confirmingSend ? (
                    <>
                      <Button size="sm" onPress={() => { void handleSend(); }} disabled={sending}>
                        {t('admin.comm.confirmSend')}
                      </Button>
                      <Button variant="ghost" size="sm" onPress={() => setConfirmingSend(false)} disabled={sending}>
                        {t('common.cancel')}
                      </Button>
                    </>
                  ) : (
                    <Button size="sm" onPress={() => setConfirmingSend(true)} disabled={sending}>
                      {t('admin.comm.sendNow')}
                    </Button>
                  )}
                </View>
              ) : (
                <Text variant="muted" className="text-xs">{t('admin.comm.alreadySentNote')}</Text>
              )}
            </CardContent>
          </Card>
        ) : null}

        {/* History */}
        <Text className="mb-3 mt-8 text-base font-bold text-foreground">{t('admin.comm.history')}</Text>
        {listLoading ? (
          <Spinner />
        ) : list.length === 0 ? (
          <Text variant="muted" className="text-xs">{t('admin.comm.empty')}</Text>
        ) : (
          <View className="gap-2">
            {list.map((c) => (
              <Pressable key={c.id} onPress={() => loadDraft(c)}>
                <Card className="active:opacity-80">
                  <CardContent className="md:px-6 md:py-4">
                    <View className="flex-row items-center justify-between">
                      <Text className="flex-1 pr-3 text-sm font-semibold text-foreground" numberOfLines={1}>{c.subject}</Text>
                      <View className={`rounded-full px-2 py-0.5 ${c.status === 'SENT' ? 'bg-green-500/15' : 'bg-amber-500/15'}`}>
                        <Text className={`text-[10px] font-medium ${c.status === 'SENT' ? 'text-green-700' : 'text-amber-700'}`}>
                          {c.status === 'SENT' ? t('admin.comm.statusSent') : t('admin.comm.statusDraft')}
                        </Text>
                      </View>
                    </View>
                    <Text variant="muted" className="mt-1 text-[11px]">
                      {new Date(c.createdAt).toLocaleDateString()} · {c._count.deliveries} {t('admin.comm.recipients')}
                    </Text>
                  </CardContent>
                </Card>
              </Pressable>
            ))}
          </View>
        )}
      </View>
    </ScrollView>
  );
}
