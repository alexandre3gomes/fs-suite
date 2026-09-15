import type { FlightCategoryResult, FlightPlan } from '@fs-suite/types';

export type CheckState = 'ok' | 'warn' | 'fail' | 'unknown';

export interface ReadinessCheck {
  id: 'weather' | 'fuel' | 'weight' | 'alternate' | 'route';
  /** i18n key for the cell label, e.g. `readiness.weather.label`. */
  labelKey: string;
  /** i18n key for the short verdict shown large, e.g. `readiness.category.VFR`. */
  stateKey: string;
  state: CheckState;
  /** i18n key + params for the one-line reason under the verdict. */
  noteKey: string;
  noteParams?: Record<string, string | number>;
}

const MINUTES_PER_HOUR = 60;

const MONTHS = [
  'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
  'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC',
] as const;

/** Two-digit hh:mm from a minute count. */
export function formatDuration(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || !isFinite(minutes)) return '—';
  const h = Math.floor(minutes / MINUTES_PER_HOUR);
  const m = Math.round(minutes % MINUTES_PER_HOUR);
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

/** `02 SEP 2026 · 1900Z` */
export function formatZulu(date: Date | string | null | undefined): string {
  if (!date) return '—';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return '—';
  const day = String(d.getUTCDate()).padStart(2, '0');
  const month = MONTHS[d.getUTCMonth()] ?? '';
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return day + ' ' + month + ' ' + d.getUTCFullYear() + ' · ' + hh + mm + 'Z';
}

/**
 * Flight categories are ordered worst-last so a route's governing condition is
 * a max. An unrecognised or null category ranks below VFR so it can never be
 * mistaken for a pass.
 */
const CATEGORY_RANK: Record<string, number> = {
  VFR: 0,
  MVFR: 1,
  IFR: 2,
  LIFR: 3,
};

function rankOf(row: FlightCategoryResult): number {
  const cat = row.flightCategory;
  if (!cat) return -1;
  return CATEGORY_RANK[cat] ?? -1;
}

/** i18n-safe category key — falls back to `unknown` for anything unmapped. */
function categoryKey(row: FlightCategoryResult | undefined): string {
  const cat = row?.flightCategory;
  if (!cat || CATEGORY_RANK[cat] === undefined) return 'readiness.category.unknown';
  return 'readiness.category.' + cat;
}

/**
 * Viability checks, derived from fields the plan already carries.
 *
 * This reports whether each item is present and self-consistent. It computes
 * nothing aeronautical, changes no rounding, and overrides no server
 * assessment. A check with no data reads `unknown`, never a green pass.
 */
export function deriveReadiness(
  plan: FlightPlan | null,
  weather: Record<string, FlightCategoryResult>,
): ReadinessCheck[] {
  if (!plan) return [];

  return [
    weatherCheck(plan, weather),
    fuelCheck(plan),
    weightCheck(plan),
    alternateCheck(plan, weather),
    routeCheck(plan),
  ];
}

function weatherCheck(
  plan: FlightPlan,
  weather: Record<string, FlightCategoryResult>,
): ReadinessCheck {
  const stations = [plan.originIcao, plan.destinationIcao, plan.alternateIcao].filter(
    (c): c is string => !!c,
  );
  const known = stations
    .map((icao) => weather[icao])
    .filter((r): r is FlightCategoryResult => !!r && rankOf(r) >= 0);

  const first = known[0];
  if (!first) {
    return {
      id: 'weather',
      labelKey: 'readiness.weather.label',
      stateKey: 'readiness.state.noData',
      state: 'unknown',
      noteKey: 'readiness.weather.noData',
    };
  }

  const worst = known.reduce((acc, r) => (rankOf(r) > rankOf(acc) ? r : acc), first);
  const summary = known
    .map((r) => r.icao + ' ' + (r.flightCategory ?? '—') + (r.derived ? '*' : ''))
    .join(' · ');

  // Any station whose category was inferred from a different aerodrome is
  // called out: "SBJD MVFR" from a station 30 NM away is a weaker claim.
  const derivedRows = known.filter((r) => r.derived);
  const firstDerived = derivedRows[0];

  const worstCategory = worst.flightCategory;
  const isVfrPlan = plan.flightRules === 'VFR';
  const state: CheckState =
    worstCategory === 'VFR'
      ? 'ok'
      : worstCategory === 'MVFR'
        ? isVfrPlan
          ? 'warn'
          : 'ok'
        : 'fail';

  if (firstDerived) {
    return {
      id: 'weather',
      labelKey: 'readiness.weather.label',
      stateKey: categoryKey(worst),
      // A derived category is never a clean pass — the pilot decides.
      state: state === 'ok' ? 'warn' : state,
      noteKey:
        derivedRows.length === 1
          ? 'readiness.weather.derivedOne'
          : 'readiness.weather.derivedMany',
      noteParams: {
        summary,
        icao: firstDerived.icao,
        station: firstDerived.referenceStation ?? '—',
        distance:
          firstDerived.referenceDistanceNm !== undefined
            ? firstDerived.referenceDistanceNm.toFixed(0)
            : '—',
        count: derivedRows.length,
      },
    };
  }

  return {
    id: 'weather',
    labelKey: 'readiness.weather.label',
    stateKey: categoryKey(worst),
    state,
    noteKey: 'readiness.weather.stations',
    noteParams: { summary },
  };
}

function fuelCheck(plan: FlightPlan): ReadinessCheck {
  const onBoard = plan.fuelCurrentTotal;
  const required = plan.fuelRequiredTotal;

  if (onBoard === null || onBoard === undefined || required === null || required === undefined) {
    return {
      id: 'fuel',
      labelKey: 'readiness.fuel.label',
      stateKey: 'readiness.state.notPlanned',
      state: 'unknown',
      noteKey: 'readiness.fuel.notPlanned',
    };
  }

  const legal = onBoard >= required;
  return {
    id: 'fuel',
    labelKey: 'readiness.fuel.label',
    stateKey: legal ? 'readiness.state.legal' : 'readiness.state.short',
    state: legal ? 'ok' : 'fail',
    // The screen formats these through the units store, so they arrive as kg.
    noteKey: legal ? 'readiness.fuel.ok' : 'readiness.fuel.short',
    noteParams: { onBoardKg: onBoard, requiredKg: required },
  };
}

function weightCheck(plan: FlightPlan): ReadinessCheck {
  const takeoff = plan.takeoffWeightKg;
  const mtow = plan.mtowKg;

  if (takeoff === null || takeoff === undefined || mtow === null || mtow === undefined) {
    return {
      id: 'weight',
      labelKey: 'readiness.weight.label',
      stateKey: 'readiness.state.notPlanned',
      state: 'unknown',
      noteKey: 'readiness.weight.notPlanned',
    };
  }

  const within = takeoff <= mtow;
  return {
    id: 'weight',
    labelKey: 'readiness.weight.label',
    stateKey: within ? 'readiness.state.within' : 'readiness.state.over',
    state: within ? 'ok' : 'fail',
    noteKey: within ? 'readiness.weight.ok' : 'readiness.weight.over',
    noteParams: { takeoffKg: takeoff, mtowKg: mtow },
  };
}

function alternateCheck(
  plan: FlightPlan,
  weather: Record<string, FlightCategoryResult>,
): ReadinessCheck {
  if (plan.alternateIcao) {
    return {
      id: 'alternate',
      labelKey: 'readiness.alternate.label',
      stateKey: 'readiness.state.filed',
      state: 'ok',
      noteKey: 'readiness.alternate.filed',
      noteParams: {
        icao: plan.alternateIcao,
        distance:
          plan.alternateTotalDistanceNm !== null && plan.alternateTotalDistanceNm !== undefined
            ? plan.alternateTotalDistanceNm.toFixed(1)
            : '—',
      },
    };
  }

  // No alternate filed. Whether that is a problem depends on the destination
  // forecast, so say which it is rather than guessing.
  const destination = plan.destinationIcao ? weather[plan.destinationIcao] : undefined;
  const destinationCategory = destination?.flightCategory;
  const destinationBelowVfr =
    !!destinationCategory &&
    destinationCategory !== 'VFR' &&
    CATEGORY_RANK[destinationCategory] !== undefined;

  return {
    id: 'alternate',
    labelKey: 'readiness.alternate.label',
    stateKey: 'readiness.state.missing',
    state: destinationBelowVfr ? 'fail' : 'warn',
    noteKey: destinationBelowVfr
      ? 'readiness.alternate.requiredByWeather'
      : 'readiness.alternate.none',
    noteParams: {
      icao: plan.destinationIcao ?? '—',
      category: destinationCategory ?? '—',
    },
  };
}

function routeCheck(plan: FlightPlan): ReadinessCheck {
  const hasRoute = !!plan.routeText && plan.routeText.trim().length > 0;
  const hasDistance =
    plan.totalDistanceNm !== null && plan.totalDistanceNm !== undefined && plan.totalDistanceNm > 0;

  if (!hasRoute && !hasDistance) {
    return {
      id: 'route',
      labelKey: 'readiness.route.label',
      stateKey: 'readiness.state.notPlanned',
      state: 'unknown',
      noteKey: 'readiness.route.notPlanned',
    };
  }

  const complete = hasRoute && hasDistance;
  return {
    id: 'route',
    labelKey: 'readiness.route.label',
    stateKey: complete ? 'readiness.state.plotted' : 'readiness.state.partial',
    state: complete ? 'ok' : 'warn',
    noteKey: complete ? 'readiness.route.ok' : 'readiness.route.partial',
    noteParams: {
      altitude: plan.plannedAltitude ?? plan.cruiseLevel ?? '—',
      waypoints: plan.routes?.length ?? 0,
    },
  };
}

/** The first check that blocks the flight, if any. Drives the alert banner. */
export function firstBlocker(checks: ReadinessCheck[]): ReadinessCheck | null {
  return checks.find((c) => c.state === 'fail') ?? null;
}
