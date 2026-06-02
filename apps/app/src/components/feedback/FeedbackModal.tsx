import { Feather } from '@expo/vector-icons';
import { Button, Spinner, Text } from '@fs-suite/ui';
import * as DocumentPicker from 'expo-document-picker';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
import { Dropdown } from 'react-native-element-dropdown';

import {
  feedbackApi,
  type FeedbackType,
  type PickedFile,
} from '../../services/feedback.service';

const MAX_FILES = 3;
const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'];

interface FeedbackModalProps {
  visible: boolean;
  onClose: () => void;
}

export function FeedbackModal({ visible, onClose }: FeedbackModalProps): JSX.Element {
  const { t } = useTranslation();

  const [type, setType] = useState<FeedbackType>('BUG_REPORT');
  const [description, setDescription] = useState('');
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const reset = useCallback(() => {
    setType('BUG_REPORT');
    setDescription('');
    setFiles([]);
    setSubmitting(false);
    setError(null);
    setSuccess(false);
  }, []);

  const handleClose = useCallback(() => {
    if (submitting) return;
    reset();
    onClose();
  }, [submitting, reset, onClose]);

  const pickFiles = useCallback(async () => {
    setError(null);
    const result = await DocumentPicker.getDocumentAsync({
      multiple: true,
      type: ALLOWED_MIME,
      copyToCacheDirectory: true,
    });
    if (result.canceled || !result.assets) return;

    const picked: PickedFile[] = result.assets.map((a) => ({
      name: a.name,
      mimeType: a.mimeType ?? 'application/octet-stream',
      uri: a.uri,
      file: (a as { file?: File }).file ?? null,
      size: a.size,
    }));

    const merged = [...files, ...picked];
    if (merged.length > MAX_FILES) {
      setError(t('feedback.tooManyFiles', { max: MAX_FILES }));
      return;
    }
    if (merged.some((f) => !ALLOWED_MIME.includes(f.mimeType))) {
      setError(t('feedback.invalidType'));
      return;
    }
    if (merged.some((f) => (f.size ?? 0) > MAX_BYTES)) {
      setError(t('feedback.fileTooLarge'));
      return;
    }
    setFiles(merged);
  }, [files, t]);

  const removeFile = useCallback((idx: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const submit = useCallback(async () => {
    if (!description.trim()) {
      setError(t('feedback.descriptionRequired'));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await feedbackApi.submit({ type, description: description.trim(), files });
      setSuccess(true);
    } catch {
      setError(t('feedback.submitError'));
    } finally {
      setSubmitting(false);
    }
  }, [description, type, files, t]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose}>
      <Pressable
        className="flex-1 items-center justify-center bg-black/50 px-4"
        onPress={handleClose}
      >
        <Pressable
          className="w-full max-w-[460px] overflow-hidden rounded-card border border-border bg-card"
          onPress={(e) => e.stopPropagation()}
          style={Platform.OS === 'web' ? ({ cursor: 'default' } as never) : undefined}
        >
          <ScrollView contentContainerStyle={{ padding: 20 }} keyboardShouldPersistTaps="handled">
            {success ? (
              <View className="items-center py-6">
                <Feather name="check-circle" size={40} color="#22c55e" />
                <Text className="mt-3 text-center text-base font-semibold text-foreground">
                  {t('feedback.successTitle')}
                </Text>
                <Text variant="muted" className="mt-1 text-center text-sm">
                  {t('feedback.successBody')}
                </Text>
                <Button className="mt-5" onPress={handleClose}>
                  <Text>{t('common.close')}</Text>
                </Button>
              </View>
            ) : (
              <>
                <View className="mb-4 flex-row items-center justify-between">
                  <Text className="text-base font-bold text-foreground">{t('feedback.title')}</Text>
                  <Pressable onPress={handleClose} hitSlop={8} disabled={submitting}>
                    <Feather name="x" size={20} color="#6b7280" />
                  </Pressable>
                </View>

                <Text className="mb-1.5 text-sm font-medium text-foreground">
                  {t('feedback.typeLabel')}
                </Text>
                <Dropdown
                  data={[
                    { label: t('feedback.typeBug'), value: 'BUG_REPORT' },
                    { label: t('feedback.typeSuggestion'), value: 'SUGGESTION' },
                  ]}
                  labelField="label"
                  valueField="value"
                  value={type}
                  onChange={(item) => setType(item.value as FeedbackType)}
                  disable={submitting}
                  style={{
                    borderWidth: 1,
                    borderColor: '#e5e7eb',
                    borderRadius: 8,
                    paddingHorizontal: 12,
                    paddingVertical: 10,
                    backgroundColor: '#fff',
                  }}
                  placeholderStyle={{ fontSize: 14, color: '#9ca3af' }}
                  selectedTextStyle={{ fontSize: 14, color: '#1a1d26' }}
                  itemTextStyle={{ fontSize: 14, color: '#1a1d26' }}
                  containerStyle={{
                    borderRadius: 8,
                    borderColor: '#e5e7eb',
                    shadowColor: '#000',
                    shadowOpacity: 0.08,
                    shadowRadius: 8,
                    shadowOffset: { width: 0, height: 4 },
                    overflow: 'hidden',
                  }}
                  maxHeight={200}
                />

                <Text className="mb-1.5 mt-4 text-sm font-medium text-foreground">
                  {t('feedback.descriptionLabel')}
                </Text>
                <TextInput
                  value={description}
                  onChangeText={setDescription}
                  placeholder={t('feedback.descriptionPlaceholder')}
                  placeholderTextColor="hsl(220, 8.9%, 46.1%)"
                  multiline
                  numberOfLines={5}
                  editable={!submitting}
                  className="min-h-[110px] rounded-md border border-input bg-background px-3 py-2.5 text-sm text-foreground"
                  style={{ textAlignVertical: 'top' }}
                />

                <Pressable
                  onPress={() => {
                    void pickFiles();
                  }}
                  disabled={submitting || files.length >= MAX_FILES}
                  className="mt-4 flex-row items-center gap-2 self-start rounded-md border border-dashed border-border px-3 py-2 active:opacity-70"
                  style={files.length >= MAX_FILES ? { opacity: 0.4 } : undefined}
                >
                  <Feather name="paperclip" size={16} color="#6b7280" />
                  <Text className="text-sm text-muted-foreground">
                    {t('feedback.attach', { count: files.length, max: MAX_FILES })}
                  </Text>
                </Pressable>

                {files.length > 0 ? (
                  <View className="mt-2 gap-1.5">
                    {files.map((f, idx) => (
                      <View
                        key={`${f.name}-${idx}`}
                        className="flex-row items-center justify-between rounded-md bg-secondary px-3 py-2"
                      >
                        <Text className="flex-1 text-xs text-foreground" numberOfLines={1}>
                          {f.name}
                        </Text>
                        <Pressable onPress={() => removeFile(idx)} hitSlop={8} disabled={submitting}>
                          <Feather name="x" size={14} color="#6b7280" />
                        </Pressable>
                      </View>
                    ))}
                  </View>
                ) : null}

                {error ? (
                  <Text className="mt-3 text-sm text-destructive">{error}</Text>
                ) : null}

                <View className="mt-5 flex-row justify-end gap-2">
                  <Button variant="ghost" onPress={handleClose} disabled={submitting}>
                    <Text>{t('common.cancel')}</Text>
                  </Button>
                  <Button
                    onPress={() => {
                      void submit();
                    }}
                    disabled={submitting || !description.trim()}
                  >
                    {submitting ? <Spinner size="sm" /> : <Text>{t('feedback.submit')}</Text>}
                  </Button>
                </View>
              </>
            )}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
