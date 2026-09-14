import type { FlightCategoryResult } from '@fs-suite/types';
import { useQuery } from '@tanstack/react-query';

import { apiClient } from '../services/api.client';

/**
 * Flight categories for a set of stations.
 *
 * Endpoint: `GET /weather/flight-categories?icaos=`
 *   controller  apps/api/src/weather/weather.controller.ts:23
 *   response    apps/api/src/weather/weather.service.ts:34 (FlightCategoryResult)
 *
 * The response field is `flightCategory`, **not** `category`, and it carries
 * `derived` / `referenceStation` / `referenceDistanceNm` — a category inferred
 * from a station 30 NM away is not the same claim as one observed on the field,
 * so callers must be able to say which it is. There is no `rawText` here; raw
 * METAR comes from `GET /weather/metar`.
 *
 * The type is imported from `@fs-suite/types` (see the weather.ts patch note in
 * this slice) rather than redeclared.
 */
export type { FlightCategoryResult };

export function useFlightCategories(icaos: (string | null | undefined)[]) {
  const codes = Array.from(
    new Set(icaos.filter((c): c is string => typeof c === 'string' && c.length > 0)),
  ).sort();
  const key = codes.join(',');

  const query = useQuery({
    queryKey: ['weather', 'flight-categories', key],
    queryFn: () =>
      apiClient.get<FlightCategoryResult[]>(
        '/weather/flight-categories?icaos=' + encodeURIComponent(key),
      ),
    enabled: key.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  const byIcao: Record<string, FlightCategoryResult> = {};
  for (const row of query.data ?? []) {
    byIcao[row.icao] = row;
  }

  return {
    byIcao,
    codes,
    loading: query.isLoading && key.length > 0,
    error: query.error,
  };
}
