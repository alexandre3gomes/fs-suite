import PostHog from 'posthog-react-native';

let posthog: PostHog | null = null;

export function initAnalytics(): PostHog | undefined {
  const key = process.env['EXPO_PUBLIC_POSTHOG_KEY'];
  if (!key || __DEV__) return undefined;

  posthog = new PostHog(key, {
    host: 'https://us.i.posthog.com',
    enableSessionReplay: false,
  });

  return posthog;
}

export function getPostHog(): PostHog | null {
  return posthog;
}

export function identifyUser(user: { id: string; email: string; name: string }): void {
  posthog?.identify(user.id, { email: user.email, name: user.name });
}

export function resetAnalytics(): void {
  posthog?.reset();
}

type Props = Record<string, string | number | boolean | null | undefined>;

export function trackEvent(event: string, properties?: Props): void {
  if (!properties) { posthog?.capture(event); return; }
  const clean: Record<string, string | number | boolean | null> = {};
  for (const [k, v] of Object.entries(properties)) {
    if (v !== undefined) clean[k] = v;
  }
  posthog?.capture(event, clean);
}

// ---- Feature-specific helpers ----

export function trackFlightPlanCreated(props: {
  flightRules: string;
  origin: string;
  destination: string;
  alternate?: string;
  aircraftType?: string;
  hasRoute: boolean;
  hasCorridor: boolean;
}): void {
  trackEvent('flight_plan_created', { feature: 'vfr_planning', ...props });
}

export function trackFlightPlanSaved(props: {
  flightPlanId?: string;
  flightRules: string;
  origin: string;
  destination: string;
}): void {
  trackEvent('flight_plan_saved', { feature: 'vfr_planning', ...props });
}

export function trackAiValidation(props: {
  origin: string;
  destination: string;
  status: string;
  provider?: string;
}): void {
  trackEvent('ai_validation_requested', { feature: 'ai_review', ...props });
}

export function trackChartViewed(props: {
  icao: string;
  chartType: string;
  source: string;
}): void {
  trackEvent('chart_viewed', { feature: 'charts', ...props });
}

export function trackWeatherViewed(props: {
  icao: string;
  layer: string;
}): void {
  trackEvent('weather_viewed', { feature: 'weather', ...props });
}

export function trackPdfExported(props: {
  origin: string;
  destination: string;
}): void {
  trackEvent('pdf_exported', { feature: 'vfr_planning', ...props });
}

export function trackSafetyAssessment(props: {
  origin: string;
  destination: string;
  status: string;
}): void {
  trackEvent('safety_assessment_viewed', { feature: 'safety', ...props });
}

export function trackSimBriefImport(props: {
  ofpId?: string;
}): void {
  trackEvent('simbrief_imported', { feature: 'simbrief', ...props });
}
