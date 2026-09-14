import type { PlanStepId } from './PlanStepStrip';
import type { ValidationItem } from './weatherTimeUtils';

/**
 * Routes a viability item to the step that holds the field it refers to.
 *
 * Presentation only: it reads `ValidationItem.id` and returns a step. It does
 * not compute, re-derive or re-rank anything — severity and message come from
 * `planViability` untouched.
 *
 * Two deliberate limits:
 *
 * 1. **Step-level, not field-level.** There are no refs or anchors on the
 *    individual inputs inside the sections, so there is nothing to scroll to.
 *    This takes the pilot to the step where the problem is fixed and stops
 *    there. Field focus needs refs inside the sections — part of the
 *    extraction, not of this mapping.
 *
 * 2. **`undefined` is a valid answer.** The API's safety checker can gain ids
 *    this app has never heard of, and its `severity` arrives through an `as`
 *    with no runtime validation. An unmapped item must still render its
 *    message; it just isn't pressable.
 */

/** Exact ids: the closed local set plus the API's static one. */
const EXACT_STEP: Record<string, PlanStepId> = {
  // validateVfrPlan (weatherTimeUtils.ts) — closed list of 11
  'no-origin': 'route',
  'no-destination': 'route',
  'no-route': 'route',
  'no-cruise-level': 'route',
  'cruise-above-max': 'route',
  'departure-past': 'route',
  'no-aircraft': 'aircraft',
  'weight-over-mtow': 'aircraft',
  'weight-unverifiable': 'aircraft',
  'fuel-insufficient': 'fuel',
  'night-fuel-reserve': 'fuel',
  // safety-checker.ts (API) — static, API-only
  'cruise-not-vfr-level': 'route',
};

/**
 * Dynamic ids, matched by prefix. Order matters only in that no prefix here is
 * a prefix of another; exact ids are resolved first regardless.
 *
 * `{role}` is `origin` | `dest` | `alternate` — note `dest`, not
 * `destination` (safety-checker.ts:271, idPrefix = role at :276). The role is
 * not an ICAO code, and the ICAO is not reconstructed from the id: it is
 * already in `message`, formatted by the API.
 */
const PREFIX_STEP: readonly (readonly [string, PlanStepId])[] = [
  ['wx-', 'route'], // wx-{role}-{imc,ceiling,vis,mvfr}
  ['no-metar-', 'route'],
  ['no-taf-', 'route'],
  ['beyond-taf-', 'route'],
  ['semicircular-', 'route'], // semicircular-{legIndex}
  ['transition-', 'route'], // transition-{waypoint}
  ['sigmet-', 'airspace'], // sigmet-{sigmetId} — severity varies, read the field
];

export function stepForItemId(id: string): PlanStepId | undefined {
  const exact = EXACT_STEP[id];
  if (exact) return exact;

  const hit = PREFIX_STEP.find(([prefix]) => id.startsWith(prefix));
  return hit ? hit[1] : undefined;
}

/** True when the strip should render this item as pressable. */
export function isItemNavigable(item: ValidationItem): boolean {
  return stepForItemId(item.id) !== undefined;
}
