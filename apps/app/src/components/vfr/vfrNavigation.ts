// VFR navigation calculations — Haversine, bearings, magnetic declination, altitudes
// All aviation logic must conform to ICAO/DECEA/ANAC standards.
// Regulatory sources and decision log: docs/vfr-regulatory-references.md

export interface RouteWaypoint {
  lat: number;
  lng: number;
  name: string;
}

export interface RouteLeg {
  from: RouteWaypoint;
  to: RouteWaypoint;
  distanceNm: number;
  trueCourse: number;
  magneticDeclination: number;
  magneticCourse: number;
  suggestedAltitudes: number[];
}

export type FlightPhase = 'climb' | 'cruise' | 'descent';

export interface EnrichedLeg extends RouteLeg {
  phase: FlightPhase;
  tas: number;
  groundSpeedKts: number;
  windCorrectionAngle: number;
  magneticHeading: number;
  timeMin: number;
  cumulativeTimeMin: number;
  cumulativeDistanceNm: number;
}

export interface AircraftPerformance {
  climbSpeedKts: number;
  cruiseSpeedKts: number;
  descentSpeedKts: number;
  climbRateFpm: number;
  descentRateFpm: number;
}

/**
 * Format decimal degrees to VFR flight plan coordinate notation.
 * Lat: DDMM[N/S]  Lon: DDDMM[E/W]
 * Example: -23.6277, -46.6546 → "2337S04639W"
 */
export function toVfrCoord(lat: number, lng: number): string {
  const latH = lat >= 0 ? 'N' : 'S';
  const lngH = lng >= 0 ? 'E' : 'W';
  const aLat = Math.abs(lat);
  const aLng = Math.abs(lng);
  const latD = Math.floor(aLat);
  const latM = Math.round((aLat - latD) * 60);
  const lngD = Math.floor(aLng);
  const lngM = Math.round((aLng - lngD) * 60);
  return `${String(latD).padStart(2, '0')}${String(latM).padStart(2, '0')}${latH}${String(lngD).padStart(3, '0')}${String(lngM).padStart(2, '0')}${lngH}`;
}

/**
 * Parse VFR coordinate notation back to decimal degrees.
 * Accepts: "2337S04639W", "2337N04639E", etc.
 * Returns null if not a valid VFR coordinate.
 */
export function parseVfrCoord(token: string): { lat: number; lng: number } | null {
  const m = token.match(/^(\d{2})(\d{2})([NS])(\d{3})(\d{2})([EW])$/);
  if (!m) return null;
  const latD = parseInt(m[1]!, 10);
  const latM = parseInt(m[2]!, 10);
  const lngD = parseInt(m[4]!, 10);
  const lngM = parseInt(m[5]!, 10);
  let lat = latD + latM / 60;
  let lng = lngD + lngM / 60;
  if (m[3] === 'S') lat = -lat;
  if (m[6] === 'W') lng = -lng;
  return { lat, lng };
}

/**
 * Parse a VFR route text into waypoints.
 * Extracts tokens that are either VFR coordinates or named identifiers,
 * skipping DCT and airway identifiers.
 * Named identifiers are returned with lat/lng = 0 (caller must resolve).
 */
export function parseVfrRouteText(text: string): RouteWaypoint[] {
  const tokens = text.toUpperCase().split(/[\s/]+/).filter((t) => t && t !== 'DCT');
  const waypoints: RouteWaypoint[] = [];
  for (const token of tokens) {
    const coord = parseVfrCoord(token);
    if (coord) {
      waypoints.push({ lat: coord.lat, lng: coord.lng, name: token });
    } else if (/^[A-Z][A-Z0-9]{1,9}$/.test(token)) {
      waypoints.push({ lat: 0, lng: 0, name: token });
    }
  }
  return waypoints;
}

// ICAO Doc 4444 Field 15 route format (DECEA practice):
// - DCT between all successive points including leading/trailing
// - Corridor name goes in Item 18 (RMK/REA), NOT in Field 15
// - Ref: docs/vfr-regulatory-references.md §1
export function buildVfrRouteText(
  _originIcao: string | null,
  waypoints: RouteWaypoint[],
  _destinationIcao: string | null,
  _corridorName?: string | null,
): string {
  if (waypoints.length === 0) return 'DCT';

  const coords = waypoints.map((w) => toVfrCoord(w.lat, w.lng));
  return `DCT ${coords.join(' DCT ')} DCT`;
}

/**
 * Build Item 18 REA remarks text.
 * Format: RMK/REA FOXTROT
 * Source: MCA 100-11 / AIC-N-20/21
 * @deprecated Use buildItem18() which consolidates all Item 18 indicators.
 */
export function buildReaRemarks(corridorName: string | null): string {
  if (!corridorName) return '';
  const clean = corridorName.toUpperCase().replace(/^REA[\s-]*/i, '').trim();
  return `RMK/REA ${clean}`;
}

// Default transition altitudes (feet) per region.
// Below TA: altitude on QNH (expressed as "A045").
// Above TA: flight level on 1013.25 hPa (expressed as "FL055").
// Ref: docs/vfr-regulatory-references.md §1.1
const TRANSITION_ALTITUDES: [string[], number][] = [
  [['SB', 'SD', 'SI', 'SJ', 'SN', 'SS', 'SW'], 5000], // Brazil — varies 3000-7000; 5000 covers most TMAs
  [['K', 'PA', 'PH', 'PB', 'PF', 'PM', 'PP', 'TJ', 'C'], 18000], // USA/Canada — FL180
];

export function getDefaultTransitionAltitude(icaoPrefix?: string): number {
  if (!icaoPrefix) return 5000;
  const upper = icaoPrefix.toUpperCase();
  for (const [prefixes, ta] of TRANSITION_ALTITUDES) {
    for (const p of prefixes) {
      if (upper.startsWith(p)) return ta;
    }
  }
  return 5000;
}

export function formatAltitudeDisplay(altFt: number, icaoPrefix?: string): string {
  const ta = getDefaultTransitionAltitude(icaoPrefix);
  if (altFt < ta) return `${altFt} ft`;
  return `FL${String(Math.round(altFt / 100)).padStart(3, '0')}`;
}

export function formatAltitudeIcao(altFt: number, icaoPrefix?: string): string {
  const ta = getDefaultTransitionAltitude(icaoPrefix);
  if (altFt < ta) return `A${String(Math.round(altFt / 100)).padStart(3, '0')}`;
  return `FL${String(Math.round(altFt / 100)).padStart(3, '0')}`;
}

export function parseCruiseLevelFt(cruiseLevel: string): number | null {
  const flMatch = cruiseLevel.match(/^FL(\d{2,3})$/i);
  if (flMatch) return parseInt(flMatch[1]!, 10) * 100;
  const aMatch = cruiseLevel.match(/^A(\d{3})$/i);
  if (aMatch) return parseInt(aMatch[1]!, 10) * 100;
  const fMatch = cruiseLevel.match(/^F(\d{3})$/i);
  if (fMatch) return parseInt(fMatch[1]!, 10) * 100;
  // Display format: "4500 ft" or "4500"
  const ftMatch = cruiseLevel.match(/^(\d{3,5})\s*(?:ft)?$/i);
  if (ftMatch) return parseInt(ftMatch[1]!, 10);
  return null;
}

export function getPerformanceCategory(cruiseSpeedKts: number): string {
  // ICAO Doc 8168 — approach speed ≈ 1.3 × Vs0 ≈ ~65% of cruise for light pistons
  const approxVat = cruiseSpeedKts * 0.65;
  if (approxVat < 91) return 'A';
  if (approxVat <= 120) return 'B';
  if (approxVat <= 140) return 'C';
  if (approxVat <= 165) return 'D';
  return 'E';
}

/**
 * Default TPA (Traffic Pattern Altitude) by aircraft performance category.
 * Standard VFR pattern altitudes — pilot should override with the value
 * published in the destination's VAC chart when available.
 *
 * - Cat A, B (most VFR pistons): 1000 ft AGL
 * - Cat C, D, E (turboprops/jets): 1500 ft AGL
 */
export function calculateDefaultTpaFt(elevationFt: number, perfCategory: string): number {
  const aglFt = perfCategory === 'A' || perfCategory === 'B' ? 1000 : 1500;
  return Math.round((elevationFt + aglFt) / 100) * 100;
}

export interface AltitudeTransition {
  fix: string;
  fromAlt: number;
  toAlt: number;
}

/**
 * Build full Item 18 (Other Information) text.
 * Auto-generates DOF, PER, and RMK (REA + altitude transitions + user remarks).
 *
 * ICAO Doc 4444 Appendix 2 — Item 18 indicator order:
 *   DOF/ PER/ RMK/  (RMK is always last)
 *
 * REA corridor info is not a standard ICAO indicator — it goes under RMK/.
 * Altitude transitions between semicircular-rule segments and corridor segments
 * are described as: CLB/[alt] ABV [fix] or DES/[alt] ABV [fix]
 */
export function buildItem18(opts: {
  corridorName?: string | null;
  corridorAltRange?: { min: number; max: number } | null;
  corridorCompAlt?: number | null;
  altitudeTransitions?: AltitudeTransition[];
  userRemarks?: string;
  dateOfFlight?: Date;
  performanceCategory?: string | null;
}): string {
  const parts: string[] = [];

  if (opts.dateOfFlight) {
    const yy = String(opts.dateOfFlight.getFullYear()).slice(-2);
    const mm = String(opts.dateOfFlight.getMonth() + 1).padStart(2, '0');
    const dd = String(opts.dateOfFlight.getDate()).padStart(2, '0');
    parts.push(`DOF/${yy}${mm}${dd}`);
  }

  if (opts.performanceCategory) {
    parts.push(`PER/${opts.performanceCategory}`);
  }

  const rmkParts: string[] = [];
  if (opts.corridorName) {
    const clean = opts.corridorName.toUpperCase().replace(/^REA[\s-]*/i, '').trim();
    const corridorAlt = opts.corridorCompAlt ?? (opts.corridorAltRange
      ? `${opts.corridorAltRange.min}/${opts.corridorAltRange.max}`
      : null);
    rmkParts.push(`REA ${clean}${corridorAlt != null ? ` ALT ${corridorAlt}` : ''}`);
  }
  if (opts.altitudeTransitions && opts.altitudeTransitions.length > 0) {
    for (const t of opts.altitudeTransitions) {
      const dir = t.toAlt > t.fromAlt ? 'CLB' : 'DES';
      rmkParts.push(`${dir} ${t.fromAlt}FT/${t.toAlt}FT ABV ${t.fix}`);
    }
  }
  if (opts.userRemarks?.trim()) {
    rmkParts.push(opts.userRemarks.trim());
  }
  if (rmkParts.length > 0) {
    parts.push(`RMK/${rmkParts.join(' ')}`);
  }

  return parts.join(' ');
}

const R_NM = 3440.065; // Earth radius in nautical miles

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function toDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

/** Great-circle distance between two points in nautical miles */
export function haversineDistanceNm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R_NM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Initial (true) bearing from point 1 to point 2 in degrees [0, 360) */
export function initialBearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLon = toRad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/**
 * Magnetic declination at a given position using WMM 2025 via geomagnetism.
 * Returns degrees — positive = East, negative = West.
 */
export function getMagneticDeclination(lat: number, lng: number): number {
  try {
    const geomagnetism = require('geomagnetism');
    const info = geomagnetism.model().point([lat, lng]);
    return info.decl;
  } catch {
    return 0;
  }
}

// --------------- VFR Cruise Level Rules ---------------

interface SemicircularRule {
  /** Magnetic track range for odd-thousands + 500 ft (3500, 5500, …) */
  oddRange: [number, number];
  /** Max VFR flight level (e.g. 195 → FL195 = 19500 ft) */
  maxFL: number;
}

const RULE_ICAO: SemicircularRule = { oddRange: [0, 180], maxFL: 195 };
const RULE_BRAZIL: SemicircularRule = { oddRange: [0, 180], maxFL: 145 };
const RULE_SOUTH: SemicircularRule = { oddRange: [90, 270], maxFL: 195 };
const RULE_NZ: SemicircularRule = { oddRange: [270, 90], maxFL: 150 };
const RULE_USA: SemicircularRule = { oddRange: [0, 180], maxFL: 175 };
const RULE_AUS: SemicircularRule = { oddRange: [0, 180], maxFL: 200 };

// ICAO prefix → rule. More specific prefixes checked first.
const REGION_RULES: [string[], SemicircularRule][] = [
  // Americas
  [['SB', 'SD', 'SI', 'SJ', 'SN', 'SS', 'SW'], RULE_BRAZIL], // Brazil — ICA 100-12 caps VFR at FL145
  [['K', 'PA', 'PH', 'PB', 'PF', 'PM', 'PP', 'TJ'], RULE_USA], // USA
  [['C'], RULE_USA],                                              // Canada
  // Southern-split Europe (France, Italy, Portugal, Spain mainland)
  [['LF'], RULE_SOUTH],     // France
  [['LI'], RULE_SOUTH],     // Italy
  [['LP'], RULE_SOUTH],     // Portugal
  [['LE', 'GE'], RULE_SOUTH], // Spain mainland + Ceuta
  [['GC'], RULE_ICAO],      // Spain Canary Islands — exception, uses ICAO standard
  // Oceania
  [['NZ'], RULE_NZ],        // New Zealand
  [['Y'], RULE_AUS],        // Australia
];

function getRuleForIcao(icao: string): SemicircularRule {
  const upper = icao.toUpperCase();
  for (const [prefixes, rule] of REGION_RULES) {
    for (const prefix of prefixes) {
      if (upper.startsWith(prefix)) return rule;
    }
  }
  return RULE_ICAO;
}

function isInOddRange(mc: number, rule: SemicircularRule): boolean {
  const [start, end] = rule.oddRange;
  if (start < end) {
    return mc >= start && mc < end;
  }
  // Wrapping range, e.g. NZ [270, 90): 270..359 or 0..89
  return mc >= start || mc < end;
}

// VFR altitudes are ALWAYS odd/even thousands + 500 ft (ICAO Annex 2, Table S3-1).
// There is no "IMC" variant — if conditions are IFR/LIFR, VFR flight is not permitted.
function generateAltitudes(odd: boolean, maxFL: number): number[] {
  const result: number[] = [];
  const start = odd ? 3 : 4;
  const maxAlt = maxFL * 100;
  for (let n = start; n * 1000 + 500 <= maxAlt; n += 2) {
    result.push(n * 1000 + 500);
  }
  return result;
}

export function suggestedVfrAltitudes(magneticCourse: number, icaoPrefix?: string): number[] {
  const mc = ((magneticCourse % 360) + 360) % 360;
  const rule = icaoPrefix ? getRuleForIcao(icaoPrefix) : RULE_ICAO;
  const odd = isInOddRange(mc, rule);
  return generateAltitudes(odd, rule.maxFL);
}

/**
 * Get the semicircular rule description for a given ICAO prefix.
 * Useful for displaying which rule applies in the UI.
 */
export function getVfrRuleInfo(icaoPrefix: string): { name: string; oddRange: [number, number]; maxFL: number } {
  const rule = getRuleForIcao(icaoPrefix);
  if (rule === RULE_SOUTH) return { name: 'south-split', ...rule };
  if (rule === RULE_NZ) return { name: 'nz', ...rule };
  if (rule === RULE_USA) return { name: 'usa', ...rule };
  if (rule === RULE_AUS) return { name: 'aus', ...rule };
  return { name: 'icao', ...rule };
}

export function suggestCruiseLevel(
  routeLegs: RouteLeg[],
  departureIcao?: string,
): { altitudes: number[]; averageMC: number } | null {
  if (routeLegs.length === 0) return null;

  let sinSum = 0;
  let cosSum = 0;
  for (const leg of routeLegs) {
    const rad = toRad(leg.magneticCourse);
    const w = leg.distanceNm || 1;
    sinSum += Math.sin(rad) * w;
    cosSum += Math.cos(rad) * w;
  }
  const avgMC = ((toDeg(Math.atan2(sinSum, cosSum)) % 360) + 360) % 360;

  return {
    altitudes: suggestedVfrAltitudes(avgMC, departureIcao),
    averageMC: Math.round(avgMC),
  };
}

// --------------- IFR Cruise Level Rules ---------------

interface IfrRule {
  oddRange: [number, number];
  maxFL: number;
}

const IFR_RULE_ICAO: IfrRule = { oddRange: [0, 180], maxFL: 410 };
const IFR_RULE_USA: IfrRule = { oddRange: [0, 180], maxFL: 410 };
const IFR_RULE_SOUTH: IfrRule = { oddRange: [90, 270], maxFL: 410 };
const IFR_RULE_NZ: IfrRule = { oddRange: [270, 90], maxFL: 410 };

const IFR_REGION_RULES: [string[], IfrRule][] = [
  [['SB', 'SD', 'SI', 'SJ', 'SN', 'SS', 'SW'], IFR_RULE_ICAO],
  [['K', 'PA', 'PH', 'PB', 'PF', 'PM', 'PP', 'TJ'], IFR_RULE_USA],
  [['C'], IFR_RULE_USA],
  [['LF'], IFR_RULE_SOUTH],
  [['LI'], IFR_RULE_SOUTH],
  [['LP'], IFR_RULE_SOUTH],
  [['LE', 'GE'], IFR_RULE_SOUTH],
  [['GC'], IFR_RULE_ICAO],
  [['NZ'], IFR_RULE_NZ],
  [['Y'], IFR_RULE_ICAO],
];

function getIfrRuleForIcao(icao: string): IfrRule {
  const upper = icao.toUpperCase();
  for (const [prefixes, rule] of IFR_REGION_RULES) {
    for (const prefix of prefixes) {
      if (upper.startsWith(prefix)) return rule;
    }
  }
  return IFR_RULE_ICAO;
}

function generateIfrAltitudes(odd: boolean, maxFL: number): number[] {
  const result: number[] = [];
  const start = odd ? 1 : 2;
  for (let n = start; n * 1000 <= maxFL * 100; n += 2) {
    result.push(n * 1000);
  }
  return result;
}

export function suggestedIfrAltitudes(magneticCourse: number, icaoPrefix?: string): number[] {
  const mc = ((magneticCourse % 360) + 360) % 360;
  const rule = icaoPrefix ? getIfrRuleForIcao(icaoPrefix) : IFR_RULE_ICAO;
  const odd = isInOddRange(mc, rule);
  return generateIfrAltitudes(odd, rule.maxFL);
}

export function suggestIfrCruiseLevel(
  routeLegs: RouteLeg[],
  departureIcao?: string,
): { altitudes: number[]; averageMC: number } | null {
  if (routeLegs.length === 0) return null;

  let sinSum = 0;
  let cosSum = 0;
  for (const leg of routeLegs) {
    const rad = toRad(leg.magneticCourse);
    const w = leg.distanceNm || 1;
    sinSum += Math.sin(rad) * w;
    cosSum += Math.cos(rad) * w;
  }
  const avgMC = ((toDeg(Math.atan2(sinSum, cosSum)) % 360) + 360) % 360;

  return {
    altitudes: suggestedIfrAltitudes(avgMC, departureIcao),
    averageMC: Math.round(avgMC),
  };
}

/**
 * IFR Top of Descent distance using 3:1 rule.
 * Returns distance in NM from destination.
 */
export function calculateTodDistance(cruiseAltFt: number, destElevationFt: number): number {
  const descent = cruiseAltFt - destElevationFt;
  if (descent <= 0) return 0;
  return Math.round((descent / 1000) * 3);
}

// --------------- Cloud Clearance Filter ---------------

export interface CloudLayer {
  cover: string;
  base: number; // AGL in feet (as reported in METAR)
}

export interface AltitudeClearance {
  altitude: number;
  blocked: boolean;
}

/**
 * VFR cloud clearance — 1000 ft vertical from BKN/OVC layers.
 * Cloud bases are AGL; elevationFt converts them to MSL for comparison.
 * Altitudes above the lowest OVC layer are also blocked (no ground reference).
 */
export function filterAltitudesByCloudClearance(
  altitudes: number[],
  clouds: CloudLayer[],
  elevationFt: number,
): AltitudeClearance[] {
  const significant = clouds.filter((c) => c.cover === 'BKN' || c.cover === 'OVC');
  if (significant.length === 0) {
    return altitudes.map((a) => ({ altitude: a, blocked: false }));
  }

  const basesMsl = significant.map((c) => c.base + elevationFt);
  const lowestOvc = clouds
    .filter((c) => c.cover === 'OVC')
    .map((c) => c.base + elevationFt)
    .sort((a, b) => a - b)[0];

  return altitudes.map((alt) => {
    if (lowestOvc !== undefined && alt >= lowestOvc) {
      return { altitude: alt, blocked: true };
    }
    const tooClose = basesMsl.some((base) => Math.abs(alt - base) < 1000);
    return { altitude: alt, blocked: tooClose };
  });
}

/** Calculate navigation data for every leg of a route */
export function calculateRouteLegs(waypoints: RouteWaypoint[], departureIcao?: string, ifr = false): RouteLeg[] {
  if (waypoints.length < 2) return [];

  const legs: RouteLeg[] = [];
  for (let i = 0; i < waypoints.length - 1; i++) {
    const from = waypoints[i]!;
    const to = waypoints[i + 1]!;

    const distanceNm = haversineDistanceNm(from.lat, from.lng, to.lat, to.lng);
    const tc = initialBearing(from.lat, from.lng, to.lat, to.lng);

    // Declination at the leg midpoint
    const midLat = (from.lat + to.lat) / 2;
    const midLng = (from.lng + to.lng) / 2;
    const decl = getMagneticDeclination(midLat, midLng);

    // MC = TC − declination (decl negative for West)
    const mc = ((tc - decl) % 360 + 360) % 360;

    legs.push({
      from,
      to,
      distanceNm,
      trueCourse: tc,
      magneticDeclination: decl,
      magneticCourse: mc,
      suggestedAltitudes: ifr ? suggestedIfrAltitudes(mc, departureIcao) : suggestedVfrAltitudes(mc, departureIcao),
    });
  }

  return legs;
}

// --------------- Route Segments ---------------

export interface RouteSegment {
  id: string;
  type: 'corridor' | 'free';
  legs: RouteLeg[];
  legIndices: number[];
  averageMC: number;
  totalDistanceNm: number;
  suggestedAltitudes: number[];
  corridorAltRange?: { min: number; max: number };
  corridorCompAlt?: number | null;
}

export interface TocTodPosition {
  lat: number;
  lng: number;
  distanceFromOriginNm: number;
  label: 'TOC' | 'TOD';
}

/**
 * VFR climb/descent plan anchored to visual references along the route.
 * The pilot navigates by waypoints + time (dead reckoning), so the start
 * of climb or descent is expressed as: "after [waypoint], fly [time]
 * minutes on heading [mag] then start climbing/descending".
 *
 * - `toc` = initial climb from origin to first cruise altitude
 * - `tod` = final descent from last cruise altitude to TPA
 * - `transitions` = manual altitude changes mid-route (pilot-defined)
 */
export interface ClimbDescentPlan {
  toc?: ClimbDescentPoint;
  tod?: ClimbDescentPoint;
  transitions?: ClimbDescentPoint[];
}

export interface ClimbDescentPoint {
  /** Kind of maneuver: initial climb, intermediate transition, or final descent */
  kind?: 'initial-climb' | 'transition-climb' | 'transition-descent' | 'final-descent';
  /** Index of the leg in routeLegs containing the maneuver start */
  legIndex: number;
  /** Waypoint the pilot uses as anchor (start of the leg containing the point) */
  fromWaypoint: string;
  /** Next waypoint visible after the maneuver (end of the leg) */
  nextWaypoint: string;
  /** Distance from the anchoring waypoint to maneuver start along this leg, in NM */
  distanceFromWaypointNm: number;
  /** Time from anchor to maneuver start at leg's ground speed, in minutes */
  timeFromWaypointMin: number;
  /** Magnetic heading to fly during this transit (from the leg) */
  headingMag: number;
  /** Altitude before maneuver (current cruise) */
  fromAltFt?: number;
  /** Altitude target after maneuver */
  targetAltFt: number;
  /** Vertical rate to use (fpm) */
  verticalRateFpm: number;
  /** Total maneuver duration in minutes */
  durationMin: number;
}

/**
 * Build a climb/descent plan anchored to route waypoints.
 *
 * @param legs            enriched route legs (with timeMin and groundSpeedKts)
 * @param originElevFt    origin elevation MSL
 * @param tpaFt           destination TPA MSL (target of descent)
 * @param cruiseAltFt     planned cruise altitude
 * @param climbRateFpm    aircraft climb rate
 * @param climbSpeedKts   climb true airspeed
 * @param descentRateFpm  comfortable descent rate (default 500 fpm)
 * @param tpaBufferNm     stabilization buffer added to TOD distance (default 2 NM)
 */
export function computeClimbDescentPlan(
  legs: EnrichedLeg[],
  originElevFt: number,
  tpaFt: number,
  cruiseAltFt: number,
  climbRateFpm: number,
  climbSpeedKts: number,
  descentRateFpm = 500,
  tpaBufferNm = 2,
  transitions: { atWaypoint: string; toAltFt: number }[] = [],
): ClimbDescentPlan {
  if (legs.length === 0 || cruiseAltFt <= 0) return {};

  const totalNm = legs.reduce((s, l) => s + l.distanceNm, 0);
  const plan: ClimbDescentPlan = {};

  // ----- TOC (initial climb from origin to first cruise altitude) -----
  // Note: first cruise altitude = base cruise OR first transition's altitude (if it's
  // before the natural TOC distance). For now, assume the pilot climbs to base
  // cruise first, then transitions take effect at their waypoints.
  const climbGainFt = cruiseAltFt - originElevFt;
  if (climbGainFt > 0 && climbRateFpm > 0) {
    const climbTimeMin = climbGainFt / climbRateFpm;
    const climbNm = (climbTimeMin / 60) * climbSpeedKts;
    if (climbNm > 0 && climbNm < totalNm) {
      const located = locateOnLegs(legs, climbNm);
      if (located) {
        const leg = legs[located.legIndex]!;
        plan.toc = {
          kind: 'initial-climb',
          legIndex: located.legIndex,
          fromWaypoint: leg.from.name,
          nextWaypoint: leg.to.name,
          distanceFromWaypointNm: Math.round(located.distanceIntoLegNm * 10) / 10,
          timeFromWaypointMin: round1(located.distanceIntoLegNm / leg.groundSpeedKts * 60),
          headingMag: leg.magneticHeading,
          fromAltFt: originElevFt,
          targetAltFt: cruiseAltFt,
          verticalRateFpm: climbRateFpm,
          durationMin: round1(climbTimeMin),
        };
      }
    }
  }

  // ----- Intermediate altitude transitions (pilot-defined) -----
  if (transitions.length > 0) {
    const wpToIndex = new Map<string, number>();
    for (let i = 0; i < legs.length; i++) wpToIndex.set(legs[i]!.from.name, i);
    // Also include destination as a possible waypoint (end of last leg)
    const lastLeg = legs[legs.length - 1]!;
    wpToIndex.set(lastLeg.to.name, legs.length);

    let currentAlt = cruiseAltFt;
    const sortedTransitions = [...transitions]
      .filter((t) => wpToIndex.has(t.atWaypoint))
      .sort((a, b) => (wpToIndex.get(a.atWaypoint) ?? 0) - (wpToIndex.get(b.atWaypoint) ?? 0));

    const transitionPoints: ClimbDescentPoint[] = [];
    for (const tr of sortedTransitions) {
      const legIdx = wpToIndex.get(tr.atWaypoint)!;
      const leg = legs[Math.min(legIdx, legs.length - 1)]!;
      const diff = tr.toAltFt - currentAlt;
      if (diff === 0) continue;
      const isClimb = diff > 0;
      const rate = isClimb ? climbRateFpm : descentRateFpm;
      const durationMin = Math.abs(diff) / rate;
      transitionPoints.push({
        kind: isClimb ? 'transition-climb' : 'transition-descent',
        legIndex: legIdx,
        fromWaypoint: tr.atWaypoint,
        nextWaypoint: leg.to.name,
        distanceFromWaypointNm: 0,
        timeFromWaypointMin: 0,
        headingMag: leg.magneticHeading,
        fromAltFt: currentAlt,
        targetAltFt: tr.toAltFt,
        verticalRateFpm: rate,
        durationMin: round1(durationMin),
      });
      currentAlt = tr.toAltFt;
    }
    if (transitionPoints.length > 0) plan.transitions = transitionPoints;
    // Use final cruise altitude (after last transition) as the TOD source
    cruiseAltFt = currentAlt;
  }

  // ----- TOD (final descent to TPA) -----
  const descentLossFt = cruiseAltFt - tpaFt;
  if (descentLossFt > 0 && descentRateFpm > 0) {
    const descentTimeMin = descentLossFt / descentRateFpm;
    const lastGs = legs[legs.length - 1]!.groundSpeedKts || 100;
    const descentNm = (descentTimeMin / 60) * lastGs + tpaBufferNm;
    const todFromOrigin = totalNm - descentNm;
    if (todFromOrigin > 0 && todFromOrigin < totalNm) {
      const located = locateOnLegs(legs, todFromOrigin);
      if (located) {
        const leg = legs[located.legIndex]!;
        plan.tod = {
          kind: 'final-descent',
          legIndex: located.legIndex,
          fromWaypoint: leg.from.name,
          nextWaypoint: leg.to.name,
          distanceFromWaypointNm: Math.round(located.distanceIntoLegNm * 10) / 10,
          timeFromWaypointMin: round1(located.distanceIntoLegNm / leg.groundSpeedKts * 60),
          headingMag: leg.magneticHeading,
          fromAltFt: cruiseAltFt,
          targetAltFt: tpaFt,
          verticalRateFpm: descentRateFpm,
          durationMin: round1(descentTimeMin),
        };
      }
    }
  }

  return plan;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function locateOnLegs(
  legs: EnrichedLeg[],
  distanceFromOriginNm: number,
): { legIndex: number; distanceIntoLegNm: number } | null {
  let acc = 0;
  for (let i = 0; i < legs.length; i++) {
    const legNm = legs[i]!.distanceNm;
    if (acc + legNm >= distanceFromOriginNm) {
      return { legIndex: i, distanceIntoLegNm: distanceFromOriginNm - acc };
    }
    acc += legNm;
  }
  return null;
}

const MIN_SEGMENT_NM = 3;

function weightedAverageMC(legs: RouteLeg[]): number {
  let sinSum = 0;
  let cosSum = 0;
  for (const leg of legs) {
    const rad = toRad(leg.magneticCourse);
    const w = leg.distanceNm || 1;
    sinSum += Math.sin(rad) * w;
    cosSum += Math.cos(rad) * w;
  }
  return Math.round(((toDeg(Math.atan2(sinSum, cosSum)) % 360) + 360) % 360);
}

export function segmentRouteLegs(
  routeLegs: RouteLeg[],
  corridorName: string | null,
  corridorAltRange: { min: number; max: number } | null,
  corridorCompAlt: number | null,
  icaoPrefix?: string,
): RouteSegment[] {
  if (routeLegs.length === 0) return [];

  if (!corridorName) {
    const mc = weightedAverageMC(routeLegs);
    const totalNm = routeLegs.reduce((s, l) => s + l.distanceNm, 0);
    return [{
      id: 'seg-0',
      type: 'free',
      legs: routeLegs,
      legIndices: routeLegs.map((_, i) => i),
      averageMC: mc,
      totalDistanceNm: totalNm,
      suggestedAltitudes: suggestedVfrAltitudes(mc, icaoPrefix),
    }];
  }

  const segments: RouteSegment[] = [];
  const preLeg = routeLegs[0]!;
  const postLeg = routeLegs[routeLegs.length - 1]!;
  const corridorLegs = routeLegs.slice(1, -1);
  const corridorIndices = corridorLegs.map((_, i) => i + 1);

  const preNm = preLeg.distanceNm;
  const postNm = postLeg.distanceNm;
  const corridorNm = corridorLegs.reduce((s, l) => s + l.distanceNm, 0);

  if (routeLegs.length <= 2) {
    const mc = weightedAverageMC(routeLegs);
    return [{
      id: 'seg-0',
      type: 'corridor',
      legs: routeLegs,
      legIndices: routeLegs.map((_, i) => i),
      averageMC: mc,
      totalDistanceNm: routeLegs.reduce((s, l) => s + l.distanceNm, 0),
      suggestedAltitudes: filterCorridorAltitudes(suggestedVfrAltitudes(mc, icaoPrefix), corridorAltRange, corridorCompAlt),
      corridorAltRange: corridorAltRange ?? undefined,
      corridorCompAlt,
    }];
  }

  // Pre-corridor segment (merge into corridor if too short)
  if (preNm >= MIN_SEGMENT_NM) {
    const mc = Math.round(preLeg.magneticCourse);
    segments.push({
      id: 'seg-pre',
      type: 'free',
      legs: [preLeg],
      legIndices: [0],
      averageMC: mc,
      totalDistanceNm: preNm,
      suggestedAltitudes: suggestedVfrAltitudes(mc, icaoPrefix),
    });
  } else {
    corridorLegs.unshift(preLeg);
    corridorIndices.unshift(0);
  }

  // Corridor segment
  if (corridorLegs.length > 0) {
    const mc = weightedAverageMC(corridorLegs);
    segments.push({
      id: 'seg-corridor',
      type: 'corridor',
      legs: corridorLegs,
      legIndices: corridorIndices,
      averageMC: mc,
      totalDistanceNm: corridorNm + (preNm < MIN_SEGMENT_NM ? preNm : 0),
      suggestedAltitudes: filterCorridorAltitudes(suggestedVfrAltitudes(mc, icaoPrefix), corridorAltRange, corridorCompAlt),
      corridorAltRange: corridorAltRange ?? undefined,
      corridorCompAlt,
    });
  }

  // Post-corridor segment (merge into corridor if too short)
  if (postNm >= MIN_SEGMENT_NM) {
    const mc = Math.round(postLeg.magneticCourse);
    segments.push({
      id: 'seg-post',
      type: 'free',
      legs: [postLeg],
      legIndices: [routeLegs.length - 1],
      averageMC: mc,
      totalDistanceNm: postNm,
      suggestedAltitudes: suggestedVfrAltitudes(mc, icaoPrefix),
    });
  }

  return segments;
}

function filterCorridorAltitudes(
  alts: number[],
  range: { min: number; max: number } | null,
  compAlt: number | null,
): number[] {
  if (compAlt != null) return [compAlt];
  if (range) return alts.filter((a) => a >= range.min && a <= range.max);
  return alts;
}

// --------------- TOC / TOD ---------------

export function calculateTocDistance(
  originElevFt: number,
  cruiseAltFt: number,
  climbRateFpm = 700,
  groundSpeedKts = 90,
): number {
  const gain = cruiseAltFt - originElevFt;
  if (gain <= 0) return 0;
  const timeMin = gain / climbRateFpm;
  return Math.round(((timeMin / 60) * groundSpeedKts) * 10) / 10;
}

export function calculateTodFromDestination(cruiseAltFt: number, destElevFt: number): number {
  const descent = cruiseAltFt - destElevFt;
  if (descent <= 0) return 0;
  return Math.round((descent / 1000) * 3);
}

/**
 * VFR Top of Descent distance targeting the destination's TPA (not field elevation).
 * The pilot levels off at TPA to join the traffic pattern; descent below TPA
 * happens within the circuit (downwind/base/final).
 *
 * Formula: distance = (cruiseFt − tpaFt) / descentRateFpm × gs/60 + bufferNm
 *
 * @param cruiseAltFt  cruise altitude MSL
 * @param tpaFt        Traffic Pattern Altitude MSL
 * @param descentRateFpm  comfortable descent rate (default 500 fpm for VFR)
 * @param groundSpeedKts  cruise ground speed
 * @param bufferNm     stabilization buffer to be level at TPA before entry (default 2 NM)
 * @returns distance in NM from destination where descent should start (returns 0
 *          when cruise is at or below TPA)
 */
export function calculateTodFromTpa(
  cruiseAltFt: number,
  tpaFt: number,
  descentRateFpm = 500,
  groundSpeedKts = 100,
  bufferNm = 2,
): number {
  const descent = cruiseAltFt - tpaFt;
  if (descent <= 0) return 0;
  const timeMin = descent / descentRateFpm;
  const descentNm = (timeMin / 60) * groundSpeedKts;
  return Math.round((descentNm + bufferNm) * 10) / 10;
}

export function interpolatePositionOnRoute(
  routePoints: { lat: number; lng: number }[],
  targetDistanceNm: number,
): { lat: number; lng: number } | null {
  if (routePoints.length < 2) return null;
  let accumulated = 0;
  for (let i = 0; i < routePoints.length - 1; i++) {
    const a = routePoints[i]!;
    const b = routePoints[i + 1]!;
    const legDist = haversineDistanceNm(a.lat, a.lng, b.lat, b.lng);
    if (accumulated + legDist >= targetDistanceNm) {
      const frac = legDist > 0 ? (targetDistanceNm - accumulated) / legDist : 0;
      return {
        lat: a.lat + frac * (b.lat - a.lat),
        lng: a.lng + frac * (b.lng - a.lng),
      };
    }
    accumulated += legDist;
  }
  return routePoints[routePoints.length - 1] ?? null;
}

// --------------- Wind Triangle & Leg Enrichment ---------------

export function calculateWindTriangle(
  tas: number,
  trueCourse: number,
  windDirection: number | null,
  windSpeed: number | null,
): { groundSpeed: number; wca: number } {
  if (windDirection === null || windSpeed === null || windSpeed === 0 || tas <= 0) {
    return { groundSpeed: tas, wca: 0 };
  }

  const tcRad = toRad(trueCourse);
  const wdRad = toRad(windDirection);

  const xwind = windSpeed * Math.sin(wdRad - tcRad);

  if (Math.abs(xwind) >= tas) {
    return { groundSpeed: Math.max(1, tas - windSpeed), wca: 0 };
  }

  const wcaRad = Math.asin(xwind / tas);
  const headwind = windSpeed * Math.cos(wdRad - tcRad);
  const gs = tas * Math.cos(wcaRad) - headwind;

  return {
    groundSpeed: Math.max(1, Math.round(gs)),
    wca: Math.round((wcaRad * 180) / Math.PI),
  };
}

export function enrichRouteLegs(
  legs: RouteLeg[],
  perf: AircraftPerformance,
  originElevFt: number,
  destElevFt: number,
  cruiseAltFt: number | null,
  windDirection: number | null,
  windSpeed: number | null,
): EnrichedLeg[] {
  if (legs.length === 0 || perf.cruiseSpeedKts <= 0) return [];

  const altFt = cruiseAltFt && cruiseAltFt > 0 ? cruiseAltFt : null;

  const tocNm = altFt
    ? calculateTocDistance(originElevFt, altFt, perf.climbRateFpm, perf.climbSpeedKts)
    : 0;
  const todFromDestNm = altFt ? calculateTodFromDestination(altFt, destElevFt) : 0;
  const totalDistNm = legs.reduce((s, l) => s + l.distanceNm, 0);
  const todFromOriginNm = totalDistNm - todFromDestNm;

  let cumDist = 0;
  let cumTime = 0;
  const enriched: EnrichedLeg[] = [];

  for (const leg of legs) {
    const legMidDist = cumDist + leg.distanceNm / 2;

    let phase: FlightPhase;
    let tas: number;
    if (altFt && legMidDist < tocNm) {
      phase = 'climb';
      tas = perf.climbSpeedKts;
    } else if (altFt && legMidDist > todFromOriginNm && todFromOriginNm > tocNm) {
      phase = 'descent';
      tas = perf.descentSpeedKts;
    } else {
      phase = 'cruise';
      tas = perf.cruiseSpeedKts;
    }

    const { groundSpeed, wca } = calculateWindTriangle(tas, leg.trueCourse, windDirection, windSpeed);
    const timeMin = groundSpeed > 0 ? (leg.distanceNm / groundSpeed) * 60 : 0;

    cumDist += leg.distanceNm;
    cumTime += timeMin;

    const mh = ((leg.magneticCourse + wca) % 360 + 360) % 360;

    enriched.push({
      ...leg,
      phase,
      tas,
      groundSpeedKts: groundSpeed,
      windCorrectionAngle: wca,
      magneticHeading: Math.round(mh),
      timeMin: Math.round(timeMin * 10) / 10,
      cumulativeTimeMin: Math.round(cumTime),
      cumulativeDistanceNm: Math.round(cumDist * 10) / 10,
    });
  }

  return enriched;
}
