import { Button, Text } from '@fs-suite/ui';
import { useTranslation } from 'react-i18next';
import { Modal, Platform, Pressable, View } from 'react-native';

import { useNotificationStore } from '../stores/notification.store';

/**
 * Renders the themed notification modal for the current `notify()` message.
 * Mounted once at the app root. Replaces the native/browser alert dialog with
 * our design-system styling. Tap the backdrop or OK to dismiss (advances queue).
 *
 * Modernist: a 2px-ruled panel, zero radius, no shadow — the dialog is the one
 * surface allowed to sit above the page, and it earns that with the rule and
 * the darkened ground rather than elevation. Actions are flush right, which is
 * the one place the system permits a non-left alignment (a dialog's actions
 * read as a unit, not as labels).
 */
export function NotificationHost(): JSX.Element | null {
  const { t } = useTranslation();
  const current = useNotificationStore((s) => s.queue[0] ?? null);
  const dismiss = useNotificationStore((s) => s.dismiss);

  if (!current) return null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={dismiss}>
      <Pressable
        className="flex-1 items-center justify-center px-4"
        style={{ backgroundColor: 'rgba(22, 32, 58, 0.55)' }}
        onPress={dismiss}
        testID="notification-backdrop"
      >
        <Pressable
          className="w-full max-w-[420px] border-2 border-rule bg-card"
          onPress={(e) => e.stopPropagation()}
          style={Platform.OS === 'web' ? ({ cursor: 'default' } as never) : undefined}
          testID="notification-dialog"
        >
          <View className="border-b-2 border-rule px-5 py-3">
            <Text variant="labelInk">
              {current.variant === 'confirm' ? t('common.confirmHeading') : t('common.noticeHeading')}
            </Text>
          </View>
          <View className="px-5 py-5">
            <Text variant="h4">{current.title}</Text>
            {current.message ? (
              <Text variant="muted" className="mt-2">
                {current.message}
              </Text>
            ) : null}
          </View>
          <View className="flex-row justify-end gap-3 border-t-2 border-rule px-5 py-3">
            {current.variant === 'confirm' ? (
              <>
                <Button variant="secondary" align="center" onPress={dismiss} testID="notification-cancel">
                  <Text>{t('common.cancel')}</Text>
                </Button>
                <Button
                  variant={current.destructive ? 'destructive' : 'default'}
                  align="center"
                  testID="notification-confirm"
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
              <Button align="center" onPress={dismiss} testID="notification-ok">
                <Text>{t('common.ok')}</Text>
              </Button>
            )}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
