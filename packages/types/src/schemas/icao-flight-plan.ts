import {
  FlightRules,
  TypeOfFlight,
  WakeTurbulenceCategory,
} from '../enums';

import type { FlightPlan } from './flight-plan';

// ── ICAO Doc 4444 Flight Plan Projection ──────────────────
// Structured representation of Items 7, 8, 9, 10, 13, 15, 16, 18, 19
// per ICAO Doc 4444 Appendix 2.

export interface IcaoItem7 {
  aircraftIdentification: string;
}

export interface IcaoItem8 {
  flightRules: 'V' | 'I' | 'Y' | 'Z';
  typeOfFlight: TypeOfFlight;
}

export interface IcaoItem9 {
  numberOfAircraft: number;
  typeOfAircraft: string;
  wakeTurbulenceCategory: WakeTurbulenceCategory;
}

export interface IcaoItem10 {
  comNavApproach: string;
  surveillance: string;
}

export interface IcaoItem13 {
  departureAerodrome: string;
  departureTime: string | null;
}

export interface IcaoItem15 {
  speedGroup: string;
  levelGroup: string;
  route: string;
  routeTokens: string[];
}

export interface IcaoItem16 {
  destinationAerodrome: string;
  totalEet: string | null;
  alternate1Aerodrome: string | null;
  alternate2Aerodrome: string | null;
}

export interface IcaoItem18 {
  text: string;
  indicators: Partial<Record<string, string>>;
}

export interface IcaoItem19 {
  endurance: string | null;
  personsOnBoard: number | null;
  pilotInCommand: string | null;
  aircraftColorMarkings: string | null;
}

export interface IcaoFlightPlanProjection {
  item7: IcaoItem7;
  item8: IcaoItem8;
  item9: IcaoItem9;
  item10: IcaoItem10;
  item13: IcaoItem13;
  item15: IcaoItem15;
  item16: IcaoItem16;
  item18: IcaoItem18;
  item19: IcaoItem19;
}

export interface IcaoProjectionContext {
  cruiseSpeedKts?: number | null;
  typeOfFlight?: TypeOfFlight;
  comNavApproach?: string;
  surveillance?: string;
}

// ── Conformity Report ─────────────────────────────────────

export type ConformityStatus = 'complete' | 'partial' | 'missing';

export type ConformityLevel =
  | 'incomplete'
  | 'simulationReady'
  | 'icaoCoreComplete'
  | 'fullBriefingComplete';

export interface ConformityItem {
  item: string;
  label: string;
  status: ConformityStatus;
  missingFields?: string[];
}

export interface ConformityReport {
  level: ConformityLevel;
  score: number;
  items: ConformityItem[];
  disclaimer: string;
}

// ── Derivation helpers ────────────────────────────────────

function deriveWakeCategory(
  mtowKg: number | null | undefined,
): WakeTurbulenceCategory {
  if (mtowKg == null) return WakeTurbulenceCategory.L;
  if (mtowKg >= 560_000) return WakeTurbulenceCategory.J;
  if (mtowKg >= 136_000) return WakeTurbulenceCategory.H;
  if (mtowKg >= 7_000) return WakeTurbulenceCategory.M;
  return WakeTurbulenceCategory.L;
}

function mapFlightRules(rules: FlightRules): 'V' | 'I' | 'Y' | 'Z' {
  switch (rules) {
    case FlightRules.VFR:
      return 'V';
    case FlightRules.IFR:
      return 'I';
    case FlightRules.IFR_VFR:
      return 'Y';
    case FlightRules.VFR_IFR:
      return 'Z';
    default:
      return 'V';
  }
}

function formatSpeedGroup(speedKts: number | null | undefined): string {
  if (speedKts == null || speedKts <= 0) return 'N0000';
  return `N${String(Math.round(speedKts)).padStart(4, '0')}`;
}

const TRANSITION_ALT_18000 = [
  'K', 'PA', 'PH', 'PB', 'PF', 'PM', 'PP', 'TJ', 'C',
];
const TRANSITION_ALT_5000 = [
  'SB', 'SD', 'SI', 'SJ', 'SN', 'SS', 'SW',
];

function getTransitionAltitude(icao: string): number {
  const u = icao.toUpperCase();
  for (const p of TRANSITION_ALT_18000) {
    if (u.startsWith(p)) return 18_000;
  }
  for (const p of TRANSITION_ALT_5000) {
    if (u.startsWith(p)) return 5_000;
  }
  return 5_000;
}

function formatAltFt(altFt: number, icaoPrefix: string): string {
  const ta = getTransitionAltitude(icaoPrefix);
  const hundreds = String(Math.round(altFt / 100)).padStart(3, '0');
  return altFt < ta ? `A${hundreds}` : `F${hundreds}`;
}

function formatLevelGroup(
  cruiseLevel: string | null | undefined,
  plannedAltitude: number | null | undefined,
  originIcao: string,
): string {
  if (cruiseLevel) {
    const fl = cruiseLevel.match(/^FL(\d{2,3})$/i);
    if (fl) return `F${fl[1]!.padStart(3, '0')}`;
    const a = cruiseLevel.match(/^A(\d{3})$/i);
    if (a) return `A${a[1]}`;
    const f = cruiseLevel.match(/^F(\d{3})$/i);
    if (f) return `F${f[1]}`;
    if (cruiseLevel.toUpperCase() === 'VFR') return 'VFR';
    const ft = cruiseLevel.match(/^(\d{3,5})\s*(?:ft)?$/i);
    if (ft) return formatAltFt(parseInt(ft[1]!, 10), originIcao);
  }
  if (plannedAltitude != null && plannedAltitude > 0) {
    return formatAltFt(plannedAltitude, originIcao);
  }
  return 'VFR';
}

function formatHhmm(minutes: number | null | undefined): string | null {
  if (minutes == null || minutes <= 0) return null;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}${String(m).padStart(2, '0')}`;
}

function formatDepartureTime(
  date: Date | string | null | undefined,
): string | null {
  if (date == null) return null;
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return null;
  return `${String(d.getUTCHours()).padStart(2, '0')}${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

function parseRouteTokens(routeText: string | null | undefined): string[] {
  if (!routeText) return [];
  return routeText.trim().split(/\s+/).filter(Boolean);
}

function performanceCategory(cruiseSpeedKts: number): string {
  const vat = cruiseSpeedKts * 0.65;
  if (vat < 91) return 'A';
  if (vat <= 120) return 'B';
  if (vat <= 140) return 'C';
  if (vat <= 165) return 'D';
  return 'E';
}

function buildItem18(
  plan: FlightPlan,
  cruiseSpeedKts: number | null | undefined,
): IcaoItem18 {
  const indicators: Record<string, string> = {};
  const parts: string[] = [];

  const depDate =
    plan.plannedDepartureUtc == null
      ? null
      : typeof plan.plannedDepartureUtc === 'string'
        ? new Date(plan.plannedDepartureUtc as string)
        : plan.plannedDepartureUtc;

  if (depDate && !isNaN(depDate.getTime())) {
    const dof = `${String(depDate.getUTCFullYear()).slice(-2)}${String(depDate.getUTCMonth() + 1).padStart(2, '0')}${String(depDate.getUTCDate()).padStart(2, '0')}`;
    indicators['DOF'] = dof;
    parts.push(`DOF/${dof}`);
  }

  if (cruiseSpeedKts && cruiseSpeedKts > 0) {
    const cat = performanceCategory(cruiseSpeedKts);
    indicators['PER'] = cat;
    parts.push(`PER/${cat}`);
  }

  if (plan.remarks?.trim()) {
    indicators['RMK'] = plan.remarks.trim();
    parts.push(`RMK/${plan.remarks.trim()}`);
  }

  return { text: parts.join(' '), indicators };
}

function buildItem19(plan: FlightPlan): IcaoItem19 {
  return {
    endurance: formatHhmm(plan.enduranceMinutes),
    personsOnBoard: plan.personsOnBoard ?? null,
    pilotInCommand: plan.pilotInCommand ?? null,
    aircraftColorMarkings: plan.aircraftColorMarkings ?? null,
  };
}

// ── Projection ────────────────────────────────────────────

export function projectFlightPlanToIcao(
  plan: FlightPlan,
  context?: IcaoProjectionContext,
): IcaoFlightPlanProjection {
  const cruiseSpeedKts =
    context?.cruiseSpeedKts ?? plan.cruiseSpeedKts ?? plan.groundSpeed ?? null;

  return {
    item7: {
      aircraftIdentification: (
        plan.registration ??
        plan.callsign ??
        'ZZZZ'
      )
        .replace(/-/g, '')
        .toUpperCase()
        .slice(0, 7),
    },

    item8: {
      flightRules: mapFlightRules(plan.flightRules),
      typeOfFlight: context?.typeOfFlight ?? TypeOfFlight.G,
    },

    item9: {
      numberOfAircraft: 1,
      typeOfAircraft: plan.aircraftType?.toUpperCase() ?? 'ZZZZ',
      wakeTurbulenceCategory: deriveWakeCategory(plan.mtowKg),
    },

    item10: {
      comNavApproach: context?.comNavApproach ?? plan.equipmentCode ?? 'S',
      surveillance: context?.surveillance ?? plan.surveillanceCode ?? 'S',
    },

    item13: {
      departureAerodrome: plan.originIcao.toUpperCase(),
      departureTime: formatDepartureTime(plan.plannedDepartureUtc),
    },

    item15: {
      speedGroup: formatSpeedGroup(cruiseSpeedKts),
      levelGroup: formatLevelGroup(
        plan.cruiseLevel,
        plan.plannedAltitude,
        plan.originIcao,
      ),
      route: plan.routeText ?? 'DCT',
      routeTokens: parseRouteTokens(plan.routeText),
    },

    item16: {
      destinationAerodrome: plan.destinationIcao.toUpperCase(),
      totalEet: formatHhmm(plan.estimatedElapsedMin),
      alternate1Aerodrome: plan.alternateIcao?.toUpperCase() ?? null,
      alternate2Aerodrome: null,
    },

    item18: buildItem18(plan, cruiseSpeedKts),
    item19: buildItem19(plan),
  };
}

// ── ICAO Text Export ──────────────────────────────────────

export function formatIcaoFlightPlanText(
  projection: IcaoFlightPlanProjection,
): string {
  const { item7, item8, item9, item10, item13, item15, item16, item18, item19 } =
    projection;

  const lines: string[] = [
    `(FPL-${item7.aircraftIdentification}-${item8.flightRules}${item8.typeOfFlight}`,
    `-${item9.numberOfAircraft}${item9.typeOfAircraft}/${item9.wakeTurbulenceCategory}-${item10.comNavApproach}/${item10.surveillance}`,
    `-${item13.departureAerodrome}${item13.departureTime ?? '0000'}`,
    `-${item15.speedGroup}${item15.levelGroup} ${item15.route}`,
    `-${item16.destinationAerodrome}${item16.totalEet ?? '0000'}${item16.alternate1Aerodrome ? ` ${item16.alternate1Aerodrome}` : ''}`,
  ];

  if (item18.text) {
    lines.push(`-${item18.text}`);
  }

  const sup: string[] = [];
  if (item19.endurance) sup.push(`E/${item19.endurance}`);
  if (item19.personsOnBoard != null) {
    sup.push(`P/${String(item19.personsOnBoard).padStart(3, '0')}`);
  }
  if (item19.pilotInCommand) sup.push(`C/${item19.pilotInCommand}`);
  if (item19.aircraftColorMarkings) {
    sup.push(`A/${item19.aircraftColorMarkings}`);
  }
  if (sup.length > 0) {
    lines.push(`-${sup.join(' ')}`);
  }

  lines.push(')');
  return lines.join('\n');
}

// ── Conformity Assessment ─────────────────────────────────

const DISCLAIMER =
  'Este plano de voo é para fins de simulação e não é equivalente a um plano de voo real registrado junto à autoridade aeronáutica.';

function checkItem(
  item: string,
  label: string,
  requiredFields: [string, unknown][],
): ConformityItem {
  const missing = requiredFields
    .filter(([, val]) => val == null || val === '' || val === 'ZZZZ')
    .map(([name]) => name);

  let status: ConformityStatus;
  if (missing.length === 0) status = 'complete';
  else if (missing.length < requiredFields.length) status = 'partial';
  else status = 'missing';

  return { item, label, status, ...(missing.length > 0 ? { missingFields: missing } : {}) };
}

export function assessConformity(plan: FlightPlan): ConformityReport {
  const items: ConformityItem[] = [
    checkItem('7', 'Aircraft Identification', [
      ['registration/callsign', plan.registration ?? plan.callsign ?? null],
    ]),
    checkItem('8', 'Flight Rules / Type of Flight', [
      ['flightRules', plan.flightRules],
    ]),
    checkItem('9', 'Type of Aircraft / Wake Turbulence', [
      ['aircraftType', plan.aircraftType],
      ['mtowKg', plan.mtowKg],
    ]),
    checkItem('10', 'Equipment / Surveillance', [
      ['equipmentCode', plan.equipmentCode],
      ['surveillanceCode', plan.surveillanceCode],
    ]),
    checkItem('13', 'Departure Aerodrome / Time', [
      ['originIcao', plan.originIcao],
      ['plannedDepartureUtc', plan.plannedDepartureUtc],
    ]),
    checkItem('15', 'Route', [
      ['cruiseSpeed', plan.cruiseSpeedKts ?? plan.groundSpeed ?? null],
      ['cruiseLevel', plan.cruiseLevel ?? plan.plannedAltitude ?? null],
      ['routeText', plan.routeText],
    ]),
    checkItem('16', 'Destination / EET', [
      ['destinationIcao', plan.destinationIcao],
      ['estimatedElapsedMin', plan.estimatedElapsedMin],
    ]),
    checkItem('18', 'Other Information', [
      ['plannedDepartureUtc', plan.plannedDepartureUtc],
    ]),
    checkItem('19', 'Supplementary Information', [
      ['enduranceMinutes', plan.enduranceMinutes],
      ['personsOnBoard', plan.personsOnBoard],
      ['pilotInCommand', plan.pilotInCommand],
    ]),
  ];

  const completeCount = items.filter((i) => i.status === 'complete').length;
  const score = items.length > 0 ? Math.round((completeCount / items.length) * 100) : 0;

  const coreItems = items.filter((i) => Number(i.item) <= 18);
  const allCoreComplete = coreItems.every((i) => i.status === 'complete');
  const allComplete = items.every((i) => i.status === 'complete');

  const simReady =
    items.find((i) => i.item === '7')?.status !== 'missing' &&
    items.find((i) => i.item === '13')?.status !== 'missing' &&
    items.find((i) => i.item === '16')?.status !== 'missing';

  let level: ConformityLevel;
  if (allComplete) level = 'fullBriefingComplete';
  else if (allCoreComplete) level = 'icaoCoreComplete';
  else if (simReady) level = 'simulationReady';
  else level = 'incomplete';

  return { level, score, items, disclaimer: DISCLAIMER };
}
