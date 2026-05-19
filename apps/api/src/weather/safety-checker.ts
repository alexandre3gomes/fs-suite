import type { ParsedMetar, ParsedTaf, TafForecastPeriod } from '@fs-suite/types';

const METAR_VALIDITY_SEC = 5400; // 90 minutes
const VMC_CEILING_MIN_FT = 1500;
const VMC_VIS_MIN_M = 5000;
const VFR_MAX_FL_BRAZIL = 145;
const VFR_MAX_FL_ICAO = 200;
const FUEL_RESERVE_DAY_MIN = 30;
const FUEL_RESERVE_NIGHT_MIN = 45;

export type ViabilityStatus = 'viable' | 'viable-with-warnings' | 'incomplete' | 'not-viable' | 'unverifiable';

export interface ValidationItem {
  id: string;
  severity: 'blocking' | 'actionable' | 'warning' | 'unverifiable';
  message: string;
  action?: string;
  source?: string;
}

export interface SafetyAssessment {
  status: ViabilityStatus;
  items: ValidationItem[];
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
  metars: Record<string, ParsedMetar>;
  tafs: Record<string, ParsedTaf>;
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

function checkAerodrome(
  icao: string,
  metar: ParsedMetar | null,
  taf: ParsedTaf | null,
  targetEpochSec: number,
  role: 'origin' | 'dest',
  items: ValidationItem[],
): void {
  const prefix = role === 'origin' ? 'origem' : 'destino';
  const idPrefix = role === 'origin' ? 'origin' : 'dest';

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
    items.push({
      id: `no-taf-${idPrefix}`,
      severity: 'unverifiable',
      message: `TAF indisponível para ${icao}. Previsão para o horário de ${role === 'origin' ? 'partida' : 'chegada'} não pode ser verificada.`,
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

  if (wx.category === 'IFR' || wx.category === 'LIFR') {
    items.push({
      id: `wx-${idPrefix}-imc`,
      severity: 'blocking',
      message: `Condições na ${prefix} (${icao}) abaixo dos mínimos VMC: ${wx.category}${wx.ceiling != null ? ` (teto: ${wx.ceiling} ft)` : ''}${wx.visibility ? ` (vis: ${wx.visibility})` : ''}. Fonte: ${srcLabel}.`,
      source: 'ICA 100-12 §3.2',
    });
  } else if (wx.category === 'MVFR') {
    items.push({
      id: `wx-${idPrefix}-mvfr`,
      severity: 'warning',
      message: `Condições marginais VFR na ${prefix} (${icao}): MVFR. Fonte: ${srcLabel}.`,
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
