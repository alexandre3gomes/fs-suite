import type { ParsedMetar, ParsedTaf, TafForecastPeriod } from '@fs-suite/types';

// --------------- Formatting ---------------

export function formatOptionalMetric(value: number | null | undefined, unit: string): string {
  if (value == null) return 'N/D';
  return `${value} ${unit}`;
}

// --------------- Constants ---------------

const METAR_VALIDITY_SEC = 5400; // 90 minutes
const VMC_CEILING_MIN_FT = 1500;
const VMC_VIS_MIN_M = 5000;
const VFR_MAX_FL_BRAZIL = 145;
const VFR_MAX_FL_ICAO = 200;
const FUEL_RESERVE_DAY_MIN = 30;
const FUEL_RESERVE_NIGHT_MIN = 45;

// --------------- Sun Position (NOAA simplified) ---------------

function julianDay(date: Date): number {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + 1;
  const d = date.getUTCDate() + (date.getUTCHours() + date.getUTCMinutes() / 60) / 24;
  const a = Math.floor((14 - m) / 12);
  const yy = y + 4800 - a;
  const mm = m + 12 * a - 3;
  return d + Math.floor((153 * mm + 2) / 5) + 365 * yy + Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400) - 32045.5;
}

function sunHourAngle(jd: number, latDeg: number, zenithDeg: number): number | null {
  const D = jd - 2451545.0;
  const g = (357.529 + 0.98560028 * D) % 360;
  const gRad = g * Math.PI / 180;
  const q = (280.459 + 0.98564736 * D) % 360;
  const L = (q + 1.915 * Math.sin(gRad) + 0.020 * Math.sin(2 * gRad)) % 360;
  const e = 23.439 - 0.00000036 * D;
  const eRad = e * Math.PI / 180;
  const LRad = L * Math.PI / 180;
  const sinDec = Math.sin(eRad) * Math.sin(LRad);
  const dec = Math.asin(sinDec);
  const latRad = latDeg * Math.PI / 180;
  const zenRad = zenithDeg * Math.PI / 180;
  const cosH = (Math.cos(zenRad) - Math.sin(latRad) * sinDec) / (Math.cos(latRad) * Math.cos(dec));
  if (cosH > 1 || cosH < -1) return null; // no rise/set at this latitude
  return Math.acos(cosH) * 180 / Math.PI;
}

function solarNoonUtcHours(jd: number, lngDeg: number): number {
  const D = jd - 2451545.0;
  const g = (357.529 + 0.98560028 * D) % 360;
  const gRad = g * Math.PI / 180;
  const q = (280.459 + 0.98564736 * D) % 360;
  const L = (q + 1.915 * Math.sin(gRad) + 0.020 * Math.sin(2 * gRad)) % 360;
  const LRad = L * Math.PI / 180;
  const RA = Math.atan2(Math.cos(23.439 * Math.PI / 180) * Math.sin(LRad), Math.cos(LRad)) * 180 / Math.PI;
  const LSMT = (q - RA + 180) % 360 - 180;
  return 12 - LSMT / 15 - lngDeg / 15;
}

export interface CivilTwilightTimes {
  eveningCivilTwilightEnd: Date | null;
  morningSunrise: Date | null;
}

export function getCivilTwilightTimes(date: Date, latDeg: number, lngDeg: number): CivilTwilightTimes {
  const jd = julianDay(date);
  const noon = solarNoonUtcHours(jd, lngDeg);
  const CIVIL_ZENITH = 96; // 90 + 6 degrees for civil twilight

  const haCivil = sunHourAngle(jd, latDeg, CIVIL_ZENITH);
  const haSunrise = sunHourAngle(jd, latDeg, 90.833);

  const base = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

  let eveningCivilTwilightEnd: Date | null = null;
  if (haCivil != null) {
    const setHours = noon + haCivil / 15;
    eveningCivilTwilightEnd = new Date(base.getTime() + setHours * 3600_000);
  }

  let morningSunrise: Date | null = null;
  if (haSunrise != null) {
    const riseHours = noon - haSunrise / 15;
    morningSunrise = new Date(base.getTime() + riseHours * 3600_000);
  }

  return { eveningCivilTwilightEnd, morningSunrise };
}

export function isNightFlight(
  departureTime: Date,
  arrivalTime: Date | null,
  originLat: number,
  originLng: number,
  destLat: number | null,
  destLng: number | null,
): boolean {
  const depTwi = getCivilTwilightTimes(departureTime, originLat, originLng);
  if (depTwi.eveningCivilTwilightEnd && departureTime >= depTwi.eveningCivilTwilightEnd) return true;
  if (depTwi.morningSunrise && departureTime < depTwi.morningSunrise) return true;

  if (arrivalTime && destLat != null && destLng != null) {
    const arrTwi = getCivilTwilightTimes(arrivalTime, destLat, destLng);
    if (arrTwi.eveningCivilTwilightEnd && arrivalTime >= arrTwi.eveningCivilTwilightEnd) return true;
    if (arrTwi.morningSunrise && arrivalTime < arrTwi.morningSunrise) return true;
  }

  return false;
}

// --------------- Date/Time Utilities ---------------

export function defaultDepartureTime(): Date {
  const now = new Date();
  const target = new Date(now.getTime() + 30 * 60_000);
  const min = target.getUTCMinutes();
  const rounded = Math.ceil(min / 5) * 5;
  target.setUTCMinutes(rounded, 0, 0);
  return target;
}

export function toDatetimeLocalValue(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const mm = String(date.getUTCMinutes()).padStart(2, '0');
  return `${y}-${m}-${d}T${hh}:${mm}`;
}

export function fromDatetimeLocalValue(value: string): Date {
  return new Date(value + 'Z');
}

export function formatZulu(date: Date): string {
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const mm = String(date.getUTCMinutes()).padStart(2, '0');
  return `${dd}${hh}${mm}Z`;
}

// --------------- Weather Source Logic ---------------

export interface WeatherAtTime {
  source: 'metar' | 'taf' | 'unavailable';
  category: string | null;
  ceiling: number | null;
  visibility: string | null;
  period?: TafForecastPeriod;
}

export function isMetarValidAt(metar: ParsedMetar, targetEpochSec: number): boolean {
  const obsEpoch = Math.floor(new Date(metar.observationTime).getTime() / 1000);
  return targetEpochSec - obsEpoch < METAR_VALIDITY_SEC;
}

export function findTafPeriodForTime(taf: ParsedTaf, targetEpochSec: number): TafForecastPeriod | null {
  if (targetEpochSec < taf.validFrom || targetEpochSec >= taf.validTo) return null;
  const basePeriods = taf.periods.filter((p) => !p.fcstChange || p.fcstChange === 'FM');
  for (let i = basePeriods.length - 1; i >= 0; i--) {
    const p = basePeriods[i]!;
    if (targetEpochSec >= p.timeFrom && targetEpochSec < p.timeTo) return p;
  }
  return taf.periods.find((p) => targetEpochSec >= p.timeFrom && targetEpochSec < p.timeTo) ?? null;
}

export function getFlightCategoryForTime(
  metar: ParsedMetar | null,
  taf: ParsedTaf | null,
  targetEpochSec: number,
): WeatherAtTime {
  if (metar && isMetarValidAt(metar, targetEpochSec)) {
    return {
      source: 'metar',
      category: metar.flightCategory,
      ceiling: metar.ceiling,
      visibility: metar.visibility,
    };
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

function isTafBeyondValidity(taf: ParsedTaf | null, targetEpochSec: number): boolean {
  if (!taf) return false;
  return targetEpochSec >= taf.validTo;
}

function visibilityToMeters(vis: string | null): number | null {
  if (vis == null) return null;
  if (vis === '6+' || vis === '10+' || vis === 'P6SM') return 10000;
  const numVal = parseFloat(vis);
  if (isNaN(numVal)) return null;
  if (numVal <= 10) return Math.round(numVal * 1609.34);
  return numVal;
}

// --------------- Validation ---------------

export interface ValidationItem {
  id: string;
  severity: 'blocking' | 'actionable' | 'warning' | 'unverifiable';
  message: string;
  action?: string;
  source?: string;
}

export type ViabilityStatus = 'viable' | 'viable-with-warnings' | 'incomplete' | 'not-viable' | 'unverifiable';

export interface PlanViability {
  status: ViabilityStatus;
  items: ValidationItem[];
}

function getMaxVfrFl(icaoPrefix: string): number {
  const upper = icaoPrefix.toUpperCase();
  if (['SB', 'SD', 'SI', 'SJ', 'SN', 'SS', 'SW'].some((p) => upper.startsWith(p))) {
    return VFR_MAX_FL_BRAZIL;
  }
  return VFR_MAX_FL_ICAO;
}

function fmtDayTime(epoch: number): string {
  const d = new Date(epoch * 1000);
  const day = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return mm === '00' ? `${day}/${hh}Z` : `${day}/${hh}${mm}Z`;
}

export interface ValidateVfrPlanParams {
  departureTime: Date;
  origin: { icao: string } | null;
  destination: { icao: string } | null;
  alternate: { icao: string } | null;
  aircraft: { cruiseSpeedKts: number | null; mtowKg: number | null } | null;
  metars: Record<string, ParsedMetar>;
  tafs: Record<string, ParsedTaf>;
  departureEpochSec: number;
  arrivalEpochSec: number | null;
  alternateArrivalEpochSec: number | null;
  cruiseLevel: string;
  totalDistanceNm: number;
  fuelOnBoardKg: number;
  minFuelKg: number;
  takeoffWeightKg: number | null;
  mtowKg: number | null;
  flightCondition: 'day' | 'night';
  enduranceMin: number;
  icaoPrefix: string;
  metarFetchFailed?: boolean;
}

export function validateVfrPlan(params: ValidateVfrPlanParams): PlanViability {
  const items: ValidationItem[] = [];

  // --- Actionable: missing data ---
  if (!params.origin) {
    items.push({ id: 'no-origin', severity: 'actionable', message: 'Selecione o aeródromo de origem.' });
  }
  if (!params.destination) {
    items.push({ id: 'no-destination', severity: 'actionable', message: 'Selecione o aeródromo de destino.' });
  }
  if (!params.aircraft) {
    items.push({ id: 'no-aircraft', severity: 'actionable', message: 'Selecione a aeronave para calcular tempo de rota, combustível e performance.' });
  }
  if (params.origin && params.destination && params.totalDistanceNm <= 0) {
    items.push({ id: 'no-route', severity: 'actionable', message: 'Defina a rota para calcular distância e tempo estimado.' });
  }
  if (!params.cruiseLevel) {
    items.push({ id: 'no-cruise-level', severity: 'actionable', message: 'Selecione o nível de cruzeiro.' });
  }

  // --- Blocking: departure in the past ---
  if (params.departureTime.getTime() < Date.now() - 60_000) {
    items.push({ id: 'departure-past', severity: 'blocking', message: 'Horário de partida já passou. Atualize para um horário futuro.' });
  }

  // --- Weather checks for origin ---
  if (params.origin) {
    const icao = params.origin.icao;
    const metar = params.metars[icao] ?? null;
    const taf = params.tafs[icao] ?? null;

    if (!metar && !taf) {
      items.push({
        id: 'no-metar-origin',
        severity: 'unverifiable',
        message: `METAR e TAF indisponíveis para ${icao}.`,
        action: 'Consulte condições meteorológicas em fontes externas (REDEMET, aviationweather.gov).',
      });
    } else {
      if (!metar) {
        items.push({
          id: 'no-metar-origin',
          severity: 'unverifiable',
          message: `METAR indisponível para ${icao}.`,
          action: 'Consulte condições meteorológicas em fontes externas.',
        });
      }

      const needsTaf = !metar || !isMetarValidAt(metar, params.departureEpochSec);
      if (needsTaf && !taf) {
        items.push({
          id: 'no-taf-origin',
          severity: 'unverifiable',
          message: `TAF indisponível para ${icao}. Previsão para o horário de partida não pode ser verificada.`,
          action: 'Consulte a previsão em fontes externas.',
        });
      } else if (needsTaf && taf && isTafBeyondValidity(taf, params.departureEpochSec)) {
        items.push({
          id: 'beyond-taf-origin',
          severity: 'unverifiable',
          message: `Horário de partida (${fmtDayTime(params.departureEpochSec)}) está além da cobertura do TAF para ${icao} (válido até ${fmtDayTime(taf.validTo)}).`,
          action: 'Verifique a previsão mais próxima da data do voo.',
        });
      } else {
        const wx = getFlightCategoryForTime(metar, taf, params.departureEpochSec);
        const srcLabel = wx.source === 'metar' ? 'METAR' : wx.period ? `TAF ${fmtDayTime(wx.period.timeFrom)}` : 'TAF';

        if (wx.category === 'IFR' || wx.category === 'LIFR') {
          items.push({
            id: 'wx-origin-imc',
            severity: 'blocking',
            message: `Condições meteorológicas na origem (${icao}) abaixo dos mínimos VMC: ${wx.category}${wx.ceiling != null ? ` (teto: ${wx.ceiling} ft)` : ''}${wx.visibility ? ` (vis: ${wx.visibility})` : ''}. Fonte: ${srcLabel}.`,
            source: 'ICA 100-12 §3.2',
          });
        } else if (wx.category === 'MVFR') {
          items.push({
            id: 'wx-origin-mvfr',
            severity: 'warning',
            message: `Condições marginais VFR na origem (${icao}): MVFR. Fonte: ${srcLabel}. Avalie cuidadosamente.`,
          });
        }

        if (wx.ceiling != null && wx.ceiling < VMC_CEILING_MIN_FT && wx.category !== 'IFR' && wx.category !== 'LIFR') {
          items.push({
            id: 'wx-origin-ceiling',
            severity: 'blocking',
            message: `Teto na origem (${icao}) inferior a ${VMC_CEILING_MIN_FT} ft AGL: ${wx.ceiling} ft. VFR não autorizado.`,
            source: 'ICA 100-12 §3.2',
          });
        }

        const visMeters = visibilityToMeters(wx.visibility);
        if (visMeters != null && visMeters < VMC_VIS_MIN_M && wx.category !== 'IFR' && wx.category !== 'LIFR') {
          items.push({
            id: 'wx-origin-vis',
            severity: 'blocking',
            message: `Visibilidade na origem (${icao}) inferior a ${VMC_VIS_MIN_M} m: ${visMeters} m. VFR não autorizado.`,
            source: 'ICA 100-12 §3.2',
          });
        }
      }
    }
  }

  // --- Weather checks for destination ---
  if (params.destination && params.arrivalEpochSec) {
    const icao = params.destination.icao;
    const metar = params.metars[icao] ?? null;
    const taf = params.tafs[icao] ?? null;

    if (!metar && !taf) {
      items.push({
        id: 'no-metar-dest',
        severity: 'unverifiable',
        message: `METAR e TAF indisponíveis para ${icao}.`,
        action: 'Consulte condições meteorológicas em fontes externas (REDEMET, aviationweather.gov).',
      });
    } else {
      if (!taf) {
        items.push({
          id: 'no-taf-dest',
          severity: 'unverifiable',
          message: `TAF indisponível para ${icao}. Previsão para o horário de chegada não pode ser verificada.`,
          action: 'Consulte a previsão em fontes externas.',
        });
      } else if (isTafBeyondValidity(taf, params.arrivalEpochSec)) {
        items.push({
          id: 'beyond-taf-dest',
          severity: 'unverifiable',
          message: `Horário de chegada (${fmtDayTime(params.arrivalEpochSec)}) está além da cobertura do TAF para ${icao} (válido até ${fmtDayTime(taf.validTo)}).`,
          action: 'Verifique a previsão mais próxima da data do voo.',
        });
      } else {
        const wx = getFlightCategoryForTime(metar, taf, params.arrivalEpochSec);
        const srcLabel = wx.source === 'metar' ? 'METAR' : wx.period ? `TAF ${fmtDayTime(wx.period.timeFrom)}` : 'TAF';

        if (wx.category === 'IFR' || wx.category === 'LIFR') {
          items.push({
            id: 'wx-dest-imc',
            severity: 'blocking',
            message: `Condições meteorológicas no destino (${icao}) abaixo dos mínimos VMC: ${wx.category}${wx.ceiling != null ? ` (teto: ${wx.ceiling} ft)` : ''}${wx.visibility ? ` (vis: ${wx.visibility})` : ''}. Fonte: ${srcLabel}.`,
            source: 'ICA 100-12 §3.2',
          });
        } else if (wx.category === 'MVFR') {
          items.push({
            id: 'wx-dest-mvfr',
            severity: 'warning',
            message: `Condições marginais VFR no destino (${icao}): MVFR. Fonte: ${srcLabel}. Avalie cuidadosamente.`,
          });
        }

        if (wx.ceiling != null && wx.ceiling < VMC_CEILING_MIN_FT && wx.category !== 'IFR' && wx.category !== 'LIFR') {
          items.push({
            id: 'wx-dest-ceiling',
            severity: 'blocking',
            message: `Teto no destino (${icao}) inferior a ${VMC_CEILING_MIN_FT} ft AGL: ${wx.ceiling} ft. VFR não autorizado.`,
            source: 'ICA 100-12 §3.2',
          });
        }

        const visMeters = visibilityToMeters(wx.visibility);
        if (visMeters != null && visMeters < VMC_VIS_MIN_M && wx.category !== 'IFR' && wx.category !== 'LIFR') {
          items.push({
            id: 'wx-dest-vis',
            severity: 'blocking',
            message: `Visibilidade no destino (${icao}) inferior a ${VMC_VIS_MIN_M} m: ${visMeters} m. VFR não autorizado.`,
            source: 'ICA 100-12 §3.2',
          });
        }
      }
    }
  }

  // --- Fetch failure ---
  if (params.metarFetchFailed) {
    items.push({
      id: 'wx-fetch-failed',
      severity: 'unverifiable',
      message: 'Não foi possível obter dados meteorológicos. Verifique sua conexão e tente novamente.',
      action: 'Se o problema persistir, consulte fontes externas.',
    });
  }

  // --- Fuel checks ---
  if (params.aircraft && params.totalDistanceNm > 0 && params.fuelOnBoardKg > 0) {
    if (params.fuelOnBoardKg < params.minFuelKg) {
      const reserveMin = params.flightCondition === 'night' ? FUEL_RESERVE_NIGHT_MIN : FUEL_RESERVE_DAY_MIN;
      items.push({
        id: 'fuel-insufficient',
        severity: 'actionable',
        message: `Combustível insuficiente: ${Math.round(params.fuelOnBoardKg)} kg < ${Math.round(params.minFuelKg)} kg mínimo (${reserveMin}min reserva ${params.flightCondition === 'night' ? 'noturna' : 'diurna'}).`,
        action: 'Aumente o combustível a bordo.',
        source: 'RBAC 91.151',
      });
    }

    if (params.flightCondition === 'night' && params.enduranceMin > 0) {
      const tripMin = params.aircraft.cruiseSpeedKts != null && params.aircraft.cruiseSpeedKts > 0 && params.totalDistanceNm > 0
        ? Math.round((params.totalDistanceNm / params.aircraft.cruiseSpeedKts) * 60)
        : 0;
      const reserveAvail = params.enduranceMin - tripMin;
      if (reserveAvail < FUEL_RESERVE_NIGHT_MIN && reserveAvail >= FUEL_RESERVE_DAY_MIN) {
        items.push({
          id: 'night-fuel-reserve',
          severity: 'actionable',
          message: `Voo noturno requer reserva de ${FUEL_RESERVE_NIGHT_MIN} min (disponível: ~${reserveAvail}min). Ajuste o combustível.`,
          action: 'Aumente o combustível para garantir 45 min de reserva.',
          source: 'RBAC 91.151(b)',
        });
      }
    }
  }

  // --- Weight check ---
  if (params.takeoffWeightKg == null || params.mtowKg == null) {
    items.push({
      id: 'weight-unverifiable',
      severity: 'unverifiable',
      message: 'Dados de peso insuficientes — não é possível verificar peso de decolagem vs. MTOW.',
      action: 'Selecione uma aeronave com dados de peso completos.',
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

  // --- Cruise level check ---
  if (params.cruiseLevel && params.icaoPrefix) {
    const maxFl = getMaxVfrFl(params.icaoPrefix);
    const flMatch = params.cruiseLevel.match(/^(?:FL|F)(\d{3})$/i);
    if (flMatch) {
      const fl = parseInt(flMatch[1]!, 10);
      if (fl > maxFl) {
        items.push({
          id: 'cruise-above-max',
          severity: 'actionable',
          message: `Nível FL${String(fl).padStart(3, '0')} excede o máximo VFR para a região (FL${String(maxFl).padStart(3, '0')}).`,
          action: 'Selecione um nível de cruzeiro mais baixo.',
          source: params.icaoPrefix.startsWith('S') ? 'ICA 100-12 §4.6' : 'ICAO Annex 2',
        });
      }
    }
  }

  // --- Determine overall status ---
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
