import { Alert, Platform } from 'react-native';

/**
 * Cross-platform alert. react-native-web's `Alert.alert` is a no-op (renders
 * nothing), so on web we fall back to the browser dialog; on native we use the
 * real `Alert`. Use this anywhere user-facing feedback is needed from a handler.
 */
export function notify(title: string, message?: string): void {
  if (Platform.OS === 'web') {
    const w = globalThis as { alert?: (msg: string) => void };
    w.alert?.(message ? `${title}\n\n${message}` : title);
    return;
  }
  Alert.alert(title, message);
}
