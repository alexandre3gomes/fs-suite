// VFR navigation calculations — Haversine, bearings, magnetic declination, altitudes
// Regulatory sources documented in docs/vfr-regulatory-references.md

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
 * Build VFR route text per ICAO Doc 4444 Item 15 / MCA 100-11.
 *
 * Field 15 contains only the route description — departure (Field 13) and
 * destination (Field 16) are NOT included. DCT separates each pair of
 * consecutive points not connected by an airway.
 *
 * Standard VFR:
 *   DCT                                          (direct, no intermediate points)
 *   DCT 2338S04640W DCT 2345S04655W DCT          (with waypoints)
 *
 * REA corridor (entry and exit coordinates with REA designator):
 *   DCT 2337S04640W REA 2345S04655W DCT
 */
export function buildVfrRouteText(
  _originIcao: string | null,
  waypoints: RouteWaypoint[],
  _destinationIcao: string | null,
  corridorName?: string | null,
): string {
  if (waypoints.length === 0) return 'DCT';

  if (corridorName && waypoints.length >= 2) {
    const entry = toVfrCoord(waypoints[0]!.lat, waypoints[0]!.lng);
    const exit = toVfrCoord(waypoints[waypoints.length - 1]!.lat, waypoints[waypoints.length - 1]!.lng);
    return `DCT ${entry} REA ${exit} DCT`;
  }

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
// Above TA: flight level on 1013.25 hPa (expressed as "F055").
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
  return `F${String(Math.round(altFt / 100)).padStart(3, '0')}`;
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

function generateAltitudes(odd: boolean, maxFL: number, imc: boolean): number[] {
  const result: number[] = [];
  const offset = imc ? 0 : 500;
  const start = odd ? 3 : 4;
  const maxAlt = maxFL * 100;
  for (let n = start; n * 1000 + offset <= maxAlt; n += 2) {
    result.push(n * 1000 + offset);
  }
  return result;
}

/**
 * VFR semicircular altitude rule — region-aware.
 * Returns valid cruising altitudes (in feet) based on magnetic course
 * and the departure aerodrome's ICAO prefix.
 * When imc=true (IFR/LIFR conditions), uses full thousands instead of +500.
 */
export function suggestedVfrAltitudes(magneticCourse: number, icaoPrefix?: string, imc = false): number[] {
  const mc = ((magneticCourse % 360) + 360) % 360;
  const rule = icaoPrefix ? getRuleForIcao(icaoPrefix) : RULE_ICAO;
  const odd = isInOddRange(mc, rule);
  return generateAltitudes(odd, rule.maxFL, imc);
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

/**
 * Suggest a single cruise level for the entire route based on the average
 * magnetic course, the departure aerodrome prefix, and weather conditions.
 * When imc=true (IFR/LIFR), altitudes use full thousands (ICA 100-12).
 */
export function suggestCruiseLevel(
  routeLegs: RouteLeg[],
  departureIcao?: string,
  imc = false,
): { altitudes: number[]; averageMC: number } | null {
  if (routeLegs.length === 0) return null;

  // Weighted average magnetic course (weighted by leg distance)
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
    altitudes: suggestedVfrAltitudes(avgMC, departureIcao, imc),
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
