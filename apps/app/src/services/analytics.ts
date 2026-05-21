import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import PostHog from 'posthog-react-native';
import { Platform, NativeModules } from 'react-native';

// --------------- State ---------------

let posthog: PostHog | null = null;
let optedOut = false;

const STORAGE_KEY = 'analytics_opt_out';

// Mutable context that piggybacks on every event
const baseContext: Record<string, string | number | boolean | null> = {};

// --------------- Helpers ---------------

function deviceLocale(): string {
  const fromConstants = (Constants.expoConfig as unknown as { locale?: string })?.locale;
  if (fromConstants) return fromConstants;
  if (Platform.OS === 'web') {
    return (globalThis as unknown as { navigator?: { language?: string } }).navigator?.language ?? 'unknown';
  }
  const settings = NativeModules['SettingsManager'] as
    | { settings?: { AppleLocale?: string; AppleLanguages?: string[] } }
    | undefined;
  return (
    settings?.settings?.AppleLocale ??
    settings?.settings?.AppleLanguages?.[0] ??
    (NativeModules['I18nManager'] as { localeIdentifier?: string } | undefined)?.localeIdentifier ??
    'unknown'
  );
}

function appVersion(): string {
  return (Constants.expoConfig?.version) ?? 'unknown';
}

function currentUrl(): string | undefined {
  if (Platform.OS !== 'web') return undefined;
  try {
    return (globalThis as unknown as { location?: { href: string } }).location?.href;
  } catch {
    return undefined;
  }
}

function buildPayload(props?: Props): Record<string, string | number | boolean | null> {
  const url = currentUrl();
  const out: Record<string, string | number | boolean | null> = {
    platform: Platform.OS,
    locale: deviceLocale(),
    app_version: appVersion(),
    ...baseContext,
  };
  if (url) out['$current_url'] = url;
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v !== undefined) out[k] = v;
    }
  }
  return out;
}

// --------------- Init / opt-out ---------------

export async function initAnalytics(): Promise<PostHog | undefined> {
  const key = process.env['EXPO_PUBLIC_POSTHOG_KEY'];
  if (!key || __DEV__) return undefined;

  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    optedOut = stored === '1';
  } catch {
    optedOut = false;
  }

  if (optedOut) return undefined;

  posthog = new PostHog(key, {
    host: 'https://us.i.posthog.com',
    enableSessionReplay: false,
  });

  return posthog;
}

export async function setOptOut(value: boolean): Promise<void> {
  optedOut = value;
  try {
    await AsyncStorage.setItem(STORAGE_KEY, value ? '1' : '0');
  } catch {
    // best-effort
  }
  if (value) {
    posthog?.optOut();
  } else {
    posthog?.optIn();
  }
}

export function isOptedOut(): boolean {
  return optedOut;
}

export function getPostHog(): PostHog | null {
  return posthog;
}

// --------------- Identify / context ---------------

export function identifyUser(user: { id: string; email: string; name: string }): void {
  posthog?.identify(user.id, { email: user.email, name: user.name });
}

export function setUserProperties(props: Props): void {
  if (!posthog) return;
  const clean: Record<string, string | number | boolean | null> = {};
  for (const [k, v] of Object.entries(props)) if (v !== undefined) clean[k] = v;
  // PostHog: setPersonProperties via identify
  posthog.identify(undefined, clean);
}

export function resetAnalytics(): void {
  posthog?.reset();
  for (const k of Object.keys(baseContext)) delete baseContext[k];
}

export function setFeatureContext(feature: string | null, subfeature?: string): void {
  if (feature) baseContext['feature'] = feature;
  else delete baseContext['feature'];
  if (subfeature) baseContext['subfeature'] = subfeature;
  else delete baseContext['subfeature'];
}

export function setSessionContext(props: Props): void {
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined) delete baseContext[k];
    else if (v !== null) baseContext[k] = v;
  }
}

// --------------- Event API ---------------

export type Props = Record<string, string | number | boolean | null | undefined>;

export function trackEvent(event: string, properties?: Props): void {
  posthog?.capture(event, buildPayload(properties));
}

export function trackScreenView(screen: string, properties?: Props): void {
  trackEvent('screen_viewed', { screen, ...properties });
}

export function trackAction(event: string, properties?: Props): void {
  trackEvent(event, properties);
}

export function trackSuccess(event: string, properties?: Props): void {
  trackEvent(event, properties);
}

export type ErrorType = 'validation' | 'network' | 'auth' | 'rate_limit' | 'permission' | 'unknown';

export function trackFailure(
  event: string,
  errorType: ErrorType,
  properties?: Props & { status_code?: number },
): void {
  trackEvent(event, { error_type: errorType, ...properties });
}

// --------------- Convenience: error categorization ---------------

export function categorizeError(err: unknown): { errorType: ErrorType; statusCode?: number } {
  const status = (err as { status?: number })?.status;
  if (typeof status === 'number') {
    if (status === 401 || status === 403) return { errorType: 'auth', statusCode: status };
    if (status === 402) return { errorType: 'permission', statusCode: status };
    if (status === 429) return { errorType: 'rate_limit', statusCode: status };
    if (status >= 400 && status < 500) return { errorType: 'validation', statusCode: status };
    if (status >= 500) return { errorType: 'network', statusCode: status };
  }
  const msg = (err as Error)?.message?.toLowerCase() ?? '';
  if (msg.includes('network') || msg.includes('fetch') || msg.includes('timeout')) return { errorType: 'network' };
  return { errorType: 'unknown' };
}
