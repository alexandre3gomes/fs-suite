import type { FlightPlan } from '@fs-suite/types';
import { useQuery } from '@tanstack/react-query';

import { apiClient } from '../services/api.client';

/** Shared cache key — the ops board and the plans list must not double-fetch. */
export const FLIGHT_PLANS_QUERY_KEY = ['flight-plans'] as const;

/**
 * The signed-in user's flight plans.
 *
 * `GET /flight-plans` returns complete plans with all relations for every
 * plan, so this is a heavy payload — hence one shared query key and a
 * staleTime, rather than a per-screen fetch. Response type is
 * `FlightPlan[]` from `@fs-suite/types`; no local shape is declared.
 *
 * Read-only: no store, service or existing hook is touched.
 */
export function useFlightPlans() {
  const query = useQuery({
    queryKey: FLIGHT_PLANS_QUERY_KEY,
    queryFn: () => apiClient.get<FlightPlan[]>('/flight-plans'),
    staleTime: 60 * 1000,
  });

  return {
    plans: query.data ?? [],
    loading: query.isLoading,
    error: query.error,
    refresh: query.refetch,
  };
}

/**
 * The flight the pilot is about to fly: the soonest plan with a planned
 * departure still in the future. Falls back to the most recently touched
 * plan so the board is never empty when plans exist but none are scheduled.
 */
export function pickNextFlight(plans: FlightPlan[]): FlightPlan | null {
  if (plans.length === 0) return null;
  const now = Date.now();

  const upcoming = plans
    .filter((p) => p.plannedDepartureUtc && new Date(p.plannedDepartureUtc).getTime() >= now)
    .sort(
      (a, b) =>
        new Date(a.plannedDepartureUtc as Date).getTime() -
        new Date(b.plannedDepartureUtc as Date).getTime(),
    );

  const soonest = upcoming[0];
  if (soonest) return soonest;

  const mostRecent = [...plans].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  )[0];

  return mostRecent ?? null;
}
