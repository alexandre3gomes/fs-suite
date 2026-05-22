import type { ParsedMetar, ParsedTaf, SigmetFeatureProperties, TafForecastPeriod } from '@fs-suite/types';

import { haversineNm, magneticCourse, routeIntersectsPolygon, segmentIntersectsPolygon } from '../common/geo.utils';
import { cruiseLevelToFeet } from '../common/wind.utils';

const METAR_VALIDITY_SEC = 5400; // 90 minutes
const VMC_CEILING_MIN_FT = 1500;
const VMC_VIS_MIN_M = 5000;
const VFR_MAX_FL_BRAZIL = 145;
const VFR_MAX_FL_ICAO = 200;
const FUEL_RESERVE_DAY_MIN = 30;
const FUEL_RESERVE_NIGHT_MIN = 45;
const SIGMET_ALT_MARGIN_FT = 2000;

export type ViabilityStatus = 'viable' | 'viable-with-warnings' | 'incomplete' | 'not-viable' | 'unverifiable';

export interface ValidationItem {
  id: string;
  severity: 'blocking' | 'actionable' | 'warning' | 'unverifiable';
  message: string;
  action?: string;
  source?: string;
}

export interface PerformanceAdjustments {
  averageHeadwindKts: number;
  estimatedTimeIncreaseMinutes: number;
  additionalFuelRequiredKg: number;
}

export interface SafetyAssessment {
  status: ViabilityStatus;
  items: ValidationItem[];
  performanceAdjustments?: PerformanceAdjustments;
}

export interface SigmetFeature {
  geometry: unknown;
  properties: SigmetFeatureProperties;
}

export interface SafetyCheckParams {
  originIcao: string | null;
  destinationIcao: string | null;
  alternateIcao: string | null;
  cruiseLevel: string | null;
  fuelOnBoardKg: number;
  minFuelKg: number;
  takeoffWeightKg: number | null;
  mtowKg: number | null;
  totalDistanceNm: number;
  cruiseSpeedKts: number | null;
  enduranceMin: number;
  flightCondition: 'day' | 'night';
  departureEpochSec: number;
  arrivalEpochSec: number | null;
  alternateArrivalEpochSec?: number | null;
  metars: Record<string, ParsedMetar>;
  tafs: Record<string, ParsedTaf>;
  routeWaypoints?: { lat: number; lon: number; name?: string }[];
  sigmets?: SigmetFeature[];
  cruiseAltitudeFt?: number | null;
  originElevationFt?: number | null;
  altitudeChanges?: { atWaypoint: string; toAltFt: number }[];
}

function isMetarValidAt(metar: ParsedMetar, targetEpochSec: number): boolean {
  const obsEpoch = Math.floor(new Date(metar.observationTime).getTime() / 1000);
  return targetEpochSec - obsEpoch < METAR_VALIDITY_SEC;
}

function findTafPeriodForTime(taf: ParsedTaf, targetEpochSec: number): TafForecastPeriod | null {
  if (targetEpochSec < taf.validFrom || targetEpochSec >= taf.validTo) return null;
  const basePeriods = taf.periods.filter((p) => !p.fcstChange || p.fcstChange === 'FM');
  for (let i = basePeriods.length - 1; i >= 0; i--) {
    const p = basePeriods[i]!;
    if (targetEpochSec >= p.timeFrom && targetEpochSec < p.timeTo) return p;
  }
  return taf.periods.find((p) => targetEpochSec >= p.timeFrom && targetEpochSec < p.timeTo) ?? null;
}

interface WeatherAtTime {
  source: 'metar' | 'taf' | 'unavailable';
  category: string | null;
  ceiling: number | null;
  visibility: string | null;
  period?: TafForecastPeriod;
}

function getFlightCategoryForTime(
  metar: ParsedMetar | null,
  taf: ParsedTaf | null,
  targetEpochSec: number,
): WeatherAtTime {
  if (metar && isMetarValidAt(metar, targetEpochSec)) {
    return { source: 'metar', category: metar.flightCategory, ceiling: metar.ceiling, visibility: metar.visibility };
  }
  if (taf) {
    const period = findTafPeriodForTime(taf, targetEpochSec);
    if (period) {
      const ceiling = period.clouds
        .filter((c) => (c.cover === 'BKN' || c.cover === 'OVC') && c.base != null)
        .sort((a, b) => (a.base ?? 99999) - (b.base ?? 99999))[0]?.base ?? null;
      return {
        source: 'taf',
        category: period.flightCategory,
        ceiling,
        visibility: period.visibility != null ? String(period.visibility) : null,
        period,
      };
    }
  }
  return { source: 'unavailable', category: null, ceiling: null, visibility: null };
}

function visibilityToMeters(vis: string | null): number | null {
  if (vis == null) return null;
  if (vis === '6+' || vis === '10+' || vis === 'P6SM') return 10000;
  const numVal = parseFloat(vis);
  if (isNaN(numVal)) return null;
  if (numVal <= 10) return Math.round(numVal * 1609.34);
  return numVal;
}

function fmtDayTime(epoch: number): string {
  const d = new Date(epoch * 1000);
  const day = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return mm === '00' ? `${day}/${hh}Z` : `${day}/${hh}${mm}Z`;
}

function getMaxVfrFl(icaoPrefix: string): number {
  const upper = icaoPrefix.toUpperCase();
  if (['SB', 'SD', 'SI', 'SJ', 'SN', 'SS', 'SW'].some((p) => upper.startsWith(p))) {
    return VFR_MAX_FL_BRAZIL;
  }
  return VFR_MAX_FL_ICAO;
}

const HAZARD_LABELS: Record<string, string> = {
  TS: 'Tempestade',
  TURB: 'Turbulência',
  ICE: 'Gelo',
  IFR: 'IFR/Teto baixo',
  MTN_OBSC: 'Obscurecimento de montanha',
  OTHER: 'Meteorologia adversa',
};

function sigmetSeverity(
  hazardType: string,
  sigmetType: string,
): 'blocking' | 'warning' {
  if (hazardType === 'TS') return 'blocking';
  if (sigmetType === 'SIGMET' && (hazardType === 'TURB' || hazardType === 'ICE')) return 'blocking';
  return 'warning';
}

function altitudeOverlaps(
  cruiseFt: number | null | undefined,
  baseFt: number | null,
  topFt: number | null,
): boolean {
  if (cruiseFt == null) return true;
  const lo = baseFt != null ? baseFt - SIGMET_ALT_MARGIN_FT : 0;
  const hi = topFt != null ? topFt + SIGMET_ALT_MARGIN_FT : 99999;
  return cruiseFt >= lo && cruiseFt <= hi;
}

export interface HazardSegment {
  fromIdx: number;
  toIdx: number;
  hazardType: string;
  severity: 'blocking' | 'warning';
  sigmetId: string;
}

export function checkSigmetIntersections(
  waypoints: { lat: number; lon: number }[],
  sigmets: SigmetFeature[],
  cruiseAltFt: number | null | undefined,
  items: ValidationItem[],
): void {
  if (waypoints.length < 2) return;

  for (const sigmet of sigmets) {
    const geo = sigmet.geometry as { type: string; coordinates: unknown } | null;
    if (!geo || (geo.type !== 'Polygon' && geo.type !== 'MultiPolygon')) continue;

    if (!routeIntersectsPolygon(waypoints, geo)) continue;

    const p = sigmet.properties;
    if (!altitudeOverlaps(cruiseAltFt, p.baseFt, p.topFt)) continue;

    const hazardLabel = HAZARD_LABELS[p.hazardType] ?? p.hazardType;
    const severity = sigmetSeverity(p.hazardType, p.sigmetType);
    const altRange = p.baseFt != null || p.topFt != null
      ? ` (${p.baseFt ?? 'SFC'}–${p.topFt != null ? `FL${Math.round(p.topFt / 100)}` : 'UNL'})`
      : '';
    const fir = p.firId ? ` — FIR ${p.firId}` : '';
    const qual = p.qualifier ? ` ${p.qualifier}` : '';
    const rawSnippet = p.rawText.length > 100 ? p.rawText.slice(0, 100) + '…' : p.rawText;

    items.push({
      id: `sigmet-${p.id}`,
      severity,
      message: `Rota intercepta ${p.sigmetType}${fir}: ${hazardLabel}${qual}${altRange}. "${rawSnippet}"`,
      source: p.sigmetType,
    });
  }
}

export function findSigmetHazardSegments(
  waypoints: { lat: number; lon: number }[],
  sigmets: SigmetFeature[],
  cruiseAltFt: number | null | undefined,
): { items: ValidationItem[]; segments: HazardSegment[] } {
  const items: ValidationItem[] = [];
  const segments: HazardSegment[] = [];
  if (waypoints.length < 2) return { items, segments };

  const seen = new Set<string>();

  for (const sigmet of sigmets) {
    const geo = sigmet.geometry as { type: string; coordinates: unknown } | null;
    if (!geo || (geo.type !== 'Polygon' && geo.type !== 'MultiPolygon')) continue;

    const p = sigmet.properties;
    if (!altitudeOverlaps(cruiseAltFt, p.baseFt, p.topFt)) continue;

    const severity = sigmetSeverity(p.hazardType, p.sigmetType);
    let hitRoute = false;

    for (let i = 0; i < waypoints.length - 1; i++) {
      if (segmentIntersectsPolygon(waypoints[i]!, waypoints[i + 1]!, geo)) {
        hitRoute = true;
        const segKey = `${i}-${p.id}`;
        if (!seen.has(segKey)) {
          seen.add(segKey);
          segments.push({ fromIdx: i, toIdx: i + 1, hazardType: p.hazardType, severity, sigmetId: p.id });
        }
      }
    }

    if (hitRoute) {
      const hazardLabel = HAZARD_LABELS[p.hazardType] ?? p.hazardType;
      const altRange = p.baseFt != null || p.topFt != null
        ? ` (${p.baseFt ?? 'SFC'}–${p.topFt != null ? `FL${Math.round(p.topFt / 100)}` : 'UNL'})`
        : '';
      const fir = p.firId ? ` — FIR ${p.firId}` : '';
      const qual = p.qualifier ? ` ${p.qualifier}` : '';
      const rawSnippet = p.rawText.length > 100 ? p.rawText.slice(0, 100) + '…' : p.rawText;

      items.push({
        id: `sigmet-${p.id}`,
        severity,
        message: `Rota intercepta ${p.sigmetType}${fir}: ${hazardLabel}${qual}${altRange}. "${rawSnippet}"`,
        source: p.sigmetType,
      });
    }
  }

  return { items, segments };
}

export function checkAerodrome(
  icao: string,
  metar: ParsedMetar | null,
  taf: ParsedTaf | null,
  targetEpochSec: number,
  role: 'origin' | 'dest' | 'alternate',
  items: ValidationItem[],
): void {
  const prefixMap = { origin: 'origem', dest: 'destino', alternate: 'alternado' } as const;
  const prefix = prefixMap[role];
  const idPrefix = role;

  if (!metar && !taf) {
    items.push({
      id: `no-metar-${idPrefix}`,
      severity: 'unverifiable',
      message: `METAR e TAF indisponíveis para ${icao}.`,
      action: 'Consulte condições meteorológicas em fontes externas (REDEMET, aviationweather.gov).',
    });
    return;
  }

  if (!metar) {
    items.push({
      id: `no-metar-${idPrefix}`,
      severity: 'unverifiable',
      message: `METAR indisponível para ${icao}.`,
      action: 'Consulte condições meteorológicas em fontes externas.',
    });
  }

  const needsTaf = !metar || !isMetarValidAt(metar, targetEpochSec);
  if (needsTaf && !taf) {
    const timeCtx = role === 'origin' ? 'partida' : role === 'dest' ? 'chegada' : 'chegada ao alternado';
    items.push({
      id: `no-taf-${idPrefix}`,
      severity: 'unverifiable',
      message: `TAF indisponível para ${icao}. Previsão para o horário de ${timeCtx} não pode ser verificada.`,
      action: 'Consulte a previsão em fontes externas.',
    });
    return;
  }

  if (needsTaf && taf && targetEpochSec >= taf.validTo) {
    items.push({
      id: `beyond-taf-${idPrefix}`,
      severity: 'unverifiable',
      message: `Horário está além da cobertura do TAF para ${icao} (válido até ${fmtDayTime(taf.validTo)}).`,
      action: 'Verifique a previsão mais próxima da data do voo.',
    });
    return;
  }

  const wx = getFlightCategoryForTime(metar, taf, targetEpochSec);
  const srcLabel = wx.source === 'metar' ? 'METAR' : wx.period ? `TAF ${fmtDayTime(wx.period.timeFrom)}` : 'TAF';
  const arrivalCtx = role !== 'origin'
    ? `, no horário estimado de ${role === 'dest' ? 'chegada' : 'chegada ao alternado'} (${fmtDayTime(targetEpochSec)})`
    : '';
  const tafPeriodRef = role !== 'origin' && wx.source === 'taf' && wx.period
    ? ` Período TAF: ${fmtDayTime(wx.period.timeFrom)}–${fmtDayTime(wx.period.timeTo)}.`
    : '';

  if (wx.category === 'IFR' || wx.category === 'LIFR') {
    items.push({
      id: `wx-${idPrefix}-imc`,
      severity: 'blocking',
      message: `Condições na ${prefix} (${icao}) abaixo dos mínimos VMC: ${wx.category}${wx.ceiling != null ? ` (teto: ${wx.ceiling} ft)` : ''}${wx.visibility ? ` (vis: ${wx.visibility})` : ''}${arrivalCtx}. Fonte: ${srcLabel}.${tafPeriodRef}`,
      source: 'ICA 100-12 §3.2',
    });
  } else if (wx.category === 'MVFR') {
    items.push({
      id: `wx-${idPrefix}-mvfr`,
      severity: 'warning',
      message: `Condições marginais VFR na ${prefix} (${icao}): MVFR${arrivalCtx}. Fonte: ${srcLabel}.${tafPeriodRef}`,
    });
  }

  if (wx.ceiling != null && wx.ceiling < VMC_CEILING_MIN_FT && wx.category !== 'IFR' && wx.category !== 'LIFR') {
    items.push({
      id: `wx-${idPrefix}-ceiling`,
      severity: 'blocking',
      message: `Teto na ${prefix} (${icao}) inferior a ${VMC_CEILING_MIN_FT} ft AGL: ${wx.ceiling} ft.`,
      source: 'ICA 100-12 §3.2',
    });
  }

  const visMeters = visibilityToMeters(wx.visibility);
  if (visMeters != null && visMeters < VMC_VIS_MIN_M && wx.category !== 'IFR' && wx.category !== 'LIFR') {
    items.push({
      id: `wx-${idPrefix}-vis`,
      severity: 'blocking',
      message: `Visibilidade na ${prefix} (${icao}) inferior a ${VMC_VIS_MIN_M} m: ${visMeters} m.`,
      source: 'ICA 100-12 §3.2',
    });
  }
}

/**
 * Validate VFR semicircular rule for each leg of the route.
 * ICA 100-12 §3.6 — applies only ABOVE 3000 ft AGL.
 *
 * - Magnetic course 000°–179° → odd thousands + 500 ft (3500, 5500, 7500, ...)
 * - Magnetic course 180°–359° → even thousands + 500 ft (4500, 6500, 8500, ...)
 *
 * Returns one ValidationItem per non-compliant leg.
 */
export function checkSemicircularCompliance(
  cruiseAltFt: number,
  legs: { fromLat: number; fromLon: number; toLat: number; toLon: number; fromName?: string; toName?: string }[],
  originElevFt: number,
): ValidationItem[] {
  const items: ValidationItem[] = [];
  // Semicircular applies only above 3000 ft AGL above origin
  if (cruiseAltFt < originElevFt + 3000) return items;

  const remainder = cruiseAltFt % 1000;
  if (remainder !== 500) {
    // Full thousands are IFR-only; VFR uses thousands + 500
    items.push({
      id: 'cruise-not-vfr-level',
      severity: 'actionable',
      message: `Nível ${cruiseAltFt.toLocaleString()} ft não é VFR — VFR requer milhares + 500 ft (ex: 4500, 6500).`,
      action: 'Selecione um nível VFR (ímpar+500 ou par+500 conforme rumo).',
      source: 'ICA 100-12 §3.6',
    });
    return items;
  }

  const altThousands = Math.floor(cruiseAltFt / 1000);
  const expectedOdd = altThousands % 2 === 1; // odd thousands are eastbound
  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i]!;
    const mc = Math.round(magneticCourse(leg.fromLat, leg.fromLon, leg.toLat, leg.toLon));
    const isEastbound = mc < 180; // 0-179 → odd+500
    const matches = (isEastbound && expectedOdd) || (!isEastbound && !expectedOdd);
    if (!matches) {
      const expectedRange = isEastbound ? 'ímpar + 500' : 'par + 500';
      const legLabel = leg.fromName && leg.toName ? `${leg.fromName} → ${leg.toName}` : `Perna ${i + 1}`;
      items.push({
        id: `semicircular-${i}`,
        severity: 'actionable',
        message: `${legLabel} (MC ${mc}°): nível ${cruiseAltFt.toLocaleString()} ft viola regra hemisférica — esperado ${expectedRange}.`,
        action: `Para MC ${mc}°, use nível ${expectedRange} (ex: ${isEastbound ? '3500/5500/7500' : '4500/6500/8500'}).`,
        source: 'ICA 100-12 §3.6',
      });
    }
  }
  return items;
}

/**
 * Validate that each manual altitude transition can be completed within the
 * available leg distance, given typical aircraft climb/descent rates.
 *
 * Climb assumed at 700 fpm (small piston). Descent at 500 fpm comfortable VFR.
 * If the climb/descent distance exceeds the leg starting at the transition
 * waypoint, returns an actionable item.
 */
export function checkTransitionFeasibility(
  waypoints: { lat: number; lon: number; name?: string }[],
  transitions: { atWaypoint: string; toAltFt: number }[],
  cruiseAltFt: number,
  groundSpeedKts: number,
  climbRateFpm = 700,
  descentRateFpm = 500,
): ValidationItem[] {
  const items: ValidationItem[] = [];
  if (waypoints.length < 2 || transitions.length === 0 || groundSpeedKts <= 0) return items;

  // Build waypoint index by name
  const wpIndex = new Map<string, number>();
  for (let i = 0; i < waypoints.length; i++) {
    const name = waypoints[i]!.name;
    if (name) wpIndex.set(name, i);
  }

  // Sort transitions by their position in the route
  const sorted = [...transitions]
    .filter((t) => wpIndex.has(t.atWaypoint))
    .sort((a, b) => (wpIndex.get(a.atWaypoint) ?? 0) - (wpIndex.get(b.atWaypoint) ?? 0));

  let currentAlt = cruiseAltFt;
  for (const tr of sorted) {
    const idx = wpIndex.get(tr.atWaypoint)!;
    // Available distance: from this waypoint to the next
    if (idx >= waypoints.length - 1) continue;
    const a = waypoints[idx]!;
    const b = waypoints[idx + 1]!;
    const availableNm = haversineNm(a.lat, a.lon, b.lat, b.lon);

    const diff = tr.toAltFt - currentAlt;
    const rate = diff > 0 ? climbRateFpm : descentRateFpm;
    const requiredMin = Math.abs(diff) / rate;
    const requiredNm = (requiredMin / 60) * groundSpeedKts;

    if (requiredNm > availableNm) {
      const dirLabel = diff > 0 ? 'subida' : 'descida';
      items.push({
        id: `transition-${tr.atWaypoint}`,
        severity: 'actionable',
        message: `Transição em ${tr.atWaypoint} (${dirLabel} ${Math.abs(diff).toLocaleString()} ft): requer ${requiredNm.toFixed(1)} NM mas a perna seguinte tem ${availableNm.toFixed(1)} NM.`,
        action: 'Considere iniciar a manobra antes ou reduzir a diferença de altitude.',
        source: 'Performance da aeronave',
      });
    }
    currentAlt = tr.toAltFt;
  }

  return items;
}

export function assessSafety(params: SafetyCheckParams): SafetyAssessment {
  const items: ValidationItem[] = [];

  if (!params.originIcao) {
    items.push({ id: 'no-origin', severity: 'actionable', message: 'Selecione o aeródromo de origem.' });
  }
  if (!params.destinationIcao) {
    items.push({ id: 'no-destination', severity: 'actionable', message: 'Selecione o aeródromo de destino.' });
  }
  if (!params.cruiseLevel) {
    items.push({ id: 'no-cruise-level', severity: 'actionable', message: 'Selecione o nível de cruzeiro.' });
  }

  if (params.originIcao) {
    checkAerodrome(
      params.originIcao,
      params.metars[params.originIcao] ?? null,
      params.tafs[params.originIcao] ?? null,
      params.departureEpochSec,
      'origin',
      items,
    );
  }

  if (params.destinationIcao && params.arrivalEpochSec) {
    checkAerodrome(
      params.destinationIcao,
      params.metars[params.destinationIcao] ?? null,
      params.tafs[params.destinationIcao] ?? null,
      params.arrivalEpochSec,
      'dest',
      items,
    );
  }

  if (params.alternateIcao) {
    const altEpoch = params.alternateArrivalEpochSec ?? params.arrivalEpochSec;
    if (altEpoch) {
      checkAerodrome(
        params.alternateIcao,
        params.metars[params.alternateIcao] ?? null,
        params.tafs[params.alternateIcao] ?? null,
        altEpoch,
        'alternate',
        items,
      );
    }
  }

  // SIGMET route intersection
  const cruiseAltFt = params.cruiseLevel ? cruiseLevelToFeet(params.cruiseLevel) : null;
  if (params.routeWaypoints && params.sigmets) {
    checkSigmetIntersections(
      params.routeWaypoints,
      params.sigmets,
      params.cruiseAltitudeFt ?? cruiseAltFt,
      items,
    );
  }

  // Fuel checks
  if (params.cruiseSpeedKts && params.totalDistanceNm > 0 && params.fuelOnBoardKg > 0) {
    if (params.fuelOnBoardKg < params.minFuelKg) {
      const reserveMin = params.flightCondition === 'night' ? FUEL_RESERVE_NIGHT_MIN : FUEL_RESERVE_DAY_MIN;
      items.push({
        id: 'fuel-insufficient',
        severity: 'actionable',
        message: `Combustível insuficiente: ${Math.round(params.fuelOnBoardKg)} kg < ${Math.round(params.minFuelKg)} kg mínimo (${reserveMin}min reserva).`,
        action: 'Aumente o combustível a bordo.',
        source: 'RBAC 91.151',
      });
    }
  }

  // Weight check
  if (params.takeoffWeightKg == null || params.mtowKg == null) {
    items.push({
      id: 'weight-unverifiable',
      severity: 'unverifiable',
      message: 'Dados de peso insuficientes — não é possível verificar peso de decolagem vs. MTOW.',
    });
  } else if (params.takeoffWeightKg > params.mtowKg) {
    const excess = Math.round(params.takeoffWeightKg - params.mtowKg);
    items.push({
      id: 'weight-over-mtow',
      severity: 'actionable',
      message: `Peso de decolagem (${Math.round(params.takeoffWeightKg)} kg) excede MTOW (${Math.round(params.mtowKg)} kg) em ${excess} kg.`,
      action: 'Reduza carga ou combustível.',
      source: 'RBAC 91.9',
    });
  }

  // Cruise level check
  if (params.cruiseLevel && params.originIcao) {
    const maxFl = getMaxVfrFl(params.originIcao);
    const flMatch = params.cruiseLevel.match(/^(?:FL|F)(\d{3})$/i);
    if (flMatch) {
      const fl = parseInt(flMatch[1]!, 10);
      if (fl > maxFl) {
        items.push({
          id: 'cruise-above-max',
          severity: 'actionable',
          message: `Nível FL${String(fl).padStart(3, '0')} excede o máximo VFR (FL${String(maxFl).padStart(3, '0')}).`,
          source: params.originIcao.startsWith('S') ? 'ICA 100-12 §4.6' : 'ICAO Annex 2',
        });
      }
    }
  }

  // Semicircular rule (VFR, per leg, only above 3000 ft AGL)
  if (params.cruiseAltitudeFt && params.routeWaypoints && params.routeWaypoints.length >= 2) {
    const legs: { fromLat: number; fromLon: number; toLat: number; toLon: number; fromName?: string; toName?: string }[] = [];
    for (let i = 0; i < params.routeWaypoints.length - 1; i++) {
      const a = params.routeWaypoints[i]!;
      const b = params.routeWaypoints[i + 1]!;
      legs.push({ fromLat: a.lat, fromLon: a.lon, toLat: b.lat, toLon: b.lon, fromName: a.name, toName: b.name });
    }
    const semiItems = checkSemicircularCompliance(
      params.cruiseAltitudeFt,
      legs,
      params.originElevationFt ?? 0,
    );
    items.push(...semiItems);
  }

  // Manual altitude transitions — feasibility with performance
  if (params.altitudeChanges && params.altitudeChanges.length > 0
      && params.cruiseAltitudeFt && params.routeWaypoints && params.cruiseSpeedKts) {
    const transItems = checkTransitionFeasibility(
      params.routeWaypoints,
      params.altitudeChanges,
      params.cruiseAltitudeFt,
      params.cruiseSpeedKts,
    );
    items.push(...transItems);
  }

  // Determine overall status
  const hasBlocking = items.some((i) => i.severity === 'blocking');
  const hasActionable = items.some((i) => i.severity === 'actionable');
  const hasUnverifiable = items.some((i) => i.severity === 'unverifiable');
  const hasWarning = items.some((i) => i.severity === 'warning');

  let status: ViabilityStatus;
  if (hasBlocking) status = 'not-viable';
  else if (hasActionable) status = 'incomplete';
  else if (hasUnverifiable) status = 'unverifiable';
  else if (hasWarning) status = 'viable-with-warnings';
  else status = 'viable';

  return { status, items };
}
