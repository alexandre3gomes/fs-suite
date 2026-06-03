import { Button, Text } from '@fs-suite/ui';
import { useTranslation } from 'react-i18next';
import { Modal, Platform, Pressable, View } from 'react-native';

import { useNotificationStore } from '../stores/notification.store';

/**
 * Renders the themed notification modal for the current `notify()` message.
 * Mounted once at the app root. Replaces the native/browser alert dialog with
 * our design-system styling. Tap the backdrop or OK to dismiss (advances queue).
 */
export function NotificationHost(): JSX.Element | null {
  const { t } = useTranslation();
  const current = useNotificationStore((s) => s.queue[0] ?? null);
  const dismiss = useNotificationStore((s) => s.dismiss);

  if (!current) return null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={dismiss}>
      <Pressable
        className="flex-1 items-center justify-center bg-black/50 px-4"
        onPress={dismiss}
      >
        <Pressable
          className="w-full max-w-[400px] overflow-hidden rounded-card border border-border bg-card"
          onPress={(e) => e.stopPropagation()}
          style={Platform.OS === 'web' ? ({ cursor: 'default' } as never) : undefined}
        >
          <View className="p-5">
            <Text className="text-base font-bold text-foreground">{current.title}</Text>
            {current.message ? (
              <Text variant="muted" className="mt-2 text-sm">
                {current.message}
              </Text>
            ) : null}
            <View className="mt-5 flex-row justify-end gap-2">
              {current.variant === 'confirm' ? (
                <>
                  <Button variant="ghost" onPress={dismiss}>
                    <Text>{t('common.cancel')}</Text>
                  </Button>
                  <Button
                    variant={current.destructive ? 'destructive' : 'default'}
                    onPress={() => {
                      const fn = current.onConfirm;
                      dismiss();
                      fn?.();
                    }}
                  >
                    <Text>{current.confirmLabel ?? t('common.ok')}</Text>
                  </Button>
                </>
              ) : (
                <Button onPress={dismiss}>
                  <Text>{t('common.ok')}</Text>
                </Button>
              )}
            </View>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
