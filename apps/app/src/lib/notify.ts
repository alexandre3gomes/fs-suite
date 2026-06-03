import { useNotificationStore } from '../stores/notification.store';

/**
 * App-wide user feedback. Renders a themed modal (see <NotificationHost />) on
 * every platform — replacing the native/browser alert dialog. Callable from any
 * handler (it's imperative, not a hook). Use for success/error messages.
 */
export function notify(title: string, message?: string): void {
  useNotificationStore.getState().push({ title, message, variant: 'alert' });
}

/**
 * Themed confirmation dialog (Cancel + Confirm). `onConfirm` runs when the user
 * confirms. Use for destructive/irreversible actions instead of a native confirm.
 */
export function confirmDialog(opts: {
  title: string;
  message?: string;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
}): void {
  useNotificationStore.getState().push({ ...opts, variant: 'confirm' });
}
