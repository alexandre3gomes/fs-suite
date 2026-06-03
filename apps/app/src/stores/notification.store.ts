import { create } from 'zustand';

export interface AppNotification {
  id: number;
  title: string;
  message?: string;
  variant: 'alert' | 'confirm';
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm?: () => void;
}

interface NotificationState {
  queue: AppNotification[];
  push: (n: Omit<AppNotification, 'id'>) => void;
  dismiss: () => void;
}

let seq = 0;

/**
 * Imperative app-wide notification queue. Fed by `notify()` / `confirmDialog()`
 * (lib/notify) and rendered by <NotificationHost /> as a themed modal —
 * replacing the ugly native/browser alert dialog. One message at a time, FIFO.
 */
export const useNotificationStore = create<NotificationState>((set) => ({
  queue: [],
  push: (n): void => set((s) => ({ queue: [...s.queue, { id: ++seq, ...n }] })),
  dismiss: (): void => set((s) => ({ queue: s.queue.slice(1) })),
}));
