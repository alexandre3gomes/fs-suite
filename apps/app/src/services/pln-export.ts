import * as FileSystem from 'expo-file-system';
import { Platform, Share } from 'react-native';

import type { VfrPlanData } from '../components/vfr/VfrPlanForm';
import { parseCruiseLevelFt } from '../components/vfr/vfrNavigation';

// MSFS `.pln` flight-plan export — targets the MSFS web planner
// (planner.flightsimulator.com) and Navigraph Charts. Little Navmap reads its
// own native `.lnmpln` (see lnmpln-export.ts) because at the AppVersionMajor 12
// the MSFS planner requires, LNM duplicates aerodromes that are present BOTH in
// DepartureID/DestinationID and as ATCWaypoints — whereas MSFS/Navigraph expect
// exactly that structure. Two formats avoid the conflict.

interface PlnWaypoint {
  id: string;
  type: 'Airport' | 'User';
  icao?: string;
  lat: number;
  lon: number;
  altFt: number;
  runway?: { number: string; designator: string } | null;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Decimal degrees → `S23° 37' 35.99"` (lat) / `W46° 39' 21.99"` (lon), un-padded. */
function toDms(value: number, isLat: boolean): string {
  const hemi = isLat ? (value >= 0 ? 'N' : 'S') : (value >= 0 ? 'E' : 'W');
  const abs = Math.abs(value);
  let deg = Math.floor(abs);
  const minFloat = (abs - deg) * 60;
  let min = Math.floor(minFloat);
  let sec = (minFloat - min) * 60;
  if (Number(sec.toFixed(2)) >= 60) { sec = 0; min += 1; }
  if (min >= 60) { min = 0; deg += 1; }
  return `${hemi}${deg}° ${min}' ${sec.toFixed(2)}"`;
}

/** Altitude in feet → `+002631.00` (sign, 6 integer digits, 2 decimals). */
function toAlt(ft: number): string {
  const sign = ft < 0 ? '-' : '+';
  const v = Math.abs(ft);
  const intPart = Math.floor(v);
  const dec = Math.round((v - intPart) * 100);
  return `${sign}${String(intPart).padStart(6, '0')}.${String(dec).padStart(2, '0')}`;
}

function worldPos(lat: number, lon: number, altFt: number): string {
  return `${toDms(lat, true)},${toDms(lon, false)},${toAlt(altFt)}`;
}

/** Strip accents + non-alphanumerics for a clean ATCWaypoint id. */
function sanitizeId(name: string, fallback: string): string {
  const clean = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritics
    .replace(/[^A-Za-z0-9]/g, '');
  return clean || fallback;
}

/** Parse a runway designation ("16L", "34", "09C") into MSFS PLN fields. */
function parseRunway(rwy?: string): { number: string; designator: string } | null {
  if (!rwy) return null;
  const m = rwy.trim().toUpperCase().match(/^0?(\d{1,2})\s*([LRC])?$/);
  if (!m) return null;
  const designator = m[2] === 'L' ? 'LEFT' : m[2] === 'R' ? 'RIGHT' : m[2] === 'C' ? 'CENTER' : 'NONE';
  return { number: String(parseInt(m[1]!, 10)), designator };
}

/** Build the MSFS PLN XML (planner.flightsimulator.com). Null if coords missing. */
export function buildPlnXml(plan: VfrPlanData): string | null {
  const hasCoord = (lat?: number, lon?: number): boolean =>
    lat != null && lon != null && !(lat === 0 && lon === 0);
  if (
    !hasCoord(plan.originLatitude, plan.originLongitude) ||
    !hasCoord(plan.destinationLatitude, plan.destinationLongitude)
  ) {
    return null;
  }

  const oLat = plan.originLatitude as number;
  const oLon = plan.originLongitude as number;
  const dLat = plan.destinationLatitude as number;
  const dLon = plan.destinationLongitude as number;

  const cruiseFt = (plan.cruiseLevel ? parseCruiseLevelFt(plan.cruiseLevel) : null) ?? 0;
  const fpType = !plan.flightRules || plan.flightRules === 'VFR' ? 'VFR' : 'IFR';
  const depAlt = plan.originElevationFt ?? 0;
  const destAlt = plan.destinationElevationFt ?? 0;
  const depRunway = parseRunway(plan.originRunwayInUse);

  // Aerodromes live ONLY in DepartureID/DestinationID (+ LLA). They are NOT
  // ATCWaypoints — else the MSFS planner shows each twice. ATCWaypoints are the
  // en-route User fixes only.
  const waypoints: PlnWaypoint[] = (plan.routeWaypoints ?? []).map((wp, i) => ({
    id: sanitizeId(wp.name, `WP${i + 1}`),
    type: 'User' as const,
    lat: wp.lat,
    lon: wp.lng,
    altFt: cruiseFt,
  }));

  // Idents must be unique within a flight plan (MSFS rejects duplicates).
  const usedIds = new Set<string>();
  for (const wp of waypoints) {
    let id = wp.id;
    let n = 2;
    while (usedIds.has(id)) id = `${wp.id}${n++}`;
    usedIds.add(id);
    wp.id = id;
  }

  const title = `${plan.originIcao} to ${plan.destinationIcao}`;
  const depLLA = worldPos(oLat, oLon, depAlt);
  const destLLA = worldPos(dLat, dLon, destAlt);

  const wpXml = waypoints
    .map((wp) => {
      const runwayBlock = wp.runway
        ? `\n            <RunwayNumberFP>${wp.runway.number}</RunwayNumberFP>` +
          (wp.runway.designator !== 'NONE' ? `\n            <RunwayDesignatorFP>${wp.runway.designator}</RunwayDesignatorFP>` : '')
        : '';
      return `        <ATCWaypoint id="${escapeXml(wp.id)}">
            <ATCWaypointType>${wp.type}</ATCWaypointType>
            <WorldPosition>${worldPos(wp.lat, wp.lon, wp.altFt)}</WorldPosition>${runwayBlock}
            <ICAO>
                <ICAOIdent>${escapeXml(wp.icao ?? wp.id)}</ICAOIdent>
            </ICAO>
        </ATCWaypoint>`;
    })
    .join('\n');

  const depPosition = depRunway
    ? `\n        <DeparturePosition>${escapeXml(depRunway.number + (depRunway.designator === 'LEFT' ? 'L' : depRunway.designator === 'RIGHT' ? 'R' : depRunway.designator === 'CENTER' ? 'C' : ''))}</DeparturePosition>`
    : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<SimBase.Document Type="AceXML" version="1,0">
    <Descr>AceXML Document</Descr>
    <FlightPlan.FlightPlan>
        <Title>${escapeXml(title)}</Title>
        <FPType>${fpType}</FPType>
        <RouteType>LowAlt</RouteType>
        <CruisingAlt>${cruiseFt.toFixed(3)}</CruisingAlt>
        <DepartureID>${escapeXml(plan.originIcao)}</DepartureID>
        <DepartureLLA>${depLLA}</DepartureLLA>
        <DestinationID>${escapeXml(plan.destinationIcao)}</DestinationID>
        <DestinationLLA>${destLLA}</DestinationLLA>
        <Descr>${escapeXml(title)}</Descr>${depPosition}
        <DepartureName>${escapeXml(plan.originName || plan.originIcao)}</DepartureName>
        <DestinationName>${escapeXml(plan.destinationName || plan.destinationIcao)}</DestinationName>
        <AppVersion>
            <AppVersionMajor>12</AppVersionMajor>
            <AppVersionBuild>282174</AppVersionBuild>
        </AppVersion>
${wpXml}
    </FlightPlan.FlightPlan>
</SimBase.Document>
`;
}

/**
 * Export the plan as a `.pln` file. On web, triggers a Blob download (matching
 * the PDF export path); on native, writes to the document directory and opens
 * the share sheet. Returns false if the plan lacks origin/destination coords.
 */
export async function exportFlightPlanPln(plan: VfrPlanData): Promise<boolean> {
  const xml = buildPlnXml(plan);
  if (!xml) return false;
  await downloadOrShare(xml, `${plan.originIcao}-${plan.destinationIcao}.pln`, 'application/xml');
  return true;
}

/**
 * Build the Navigraph Charts PLN. Mirrors the format SimBrief/Navigraph emit:
 * bare SimBase.Document, aerodromes only in DepartureID/DestinationID, en-route
 * User waypoints (no ICAO block), and — crucially — the runways in
 * <DepartureDetails>/<ArrivalDetails> blocks, which is where Navigraph reads the
 * planned runway from (it ignores RunwayNumberFP on ATCWaypoints).
 */
export function buildChartsPlnXml(plan: VfrPlanData): string | null {
  const hasCoord = (lat?: number, lon?: number): boolean =>
    lat != null && lon != null && !(lat === 0 && lon === 0);
  if (
    !hasCoord(plan.originLatitude, plan.originLongitude) ||
    !hasCoord(plan.destinationLatitude, plan.destinationLongitude)
  ) {
    return null;
  }

  const cruiseFt = (plan.cruiseLevel ? parseCruiseLevelFt(plan.cruiseLevel) : null) ?? 0;
  const fpType = !plan.flightRules || plan.flightRules === 'VFR' ? 'VFR' : 'IFR';
  const depRwy = parseRunway(plan.originRunwayInUse);
  const arrRwy = parseRunway(plan.destinationRunwayInUse);

  const runwayBlock = (r: { number: string; designator: string }): string =>
    `\n            <RunwayNumberFP>${r.number}</RunwayNumberFP>` +
    (r.designator !== 'NONE' ? `\n            <RunwayDesignatorFP>${r.designator}</RunwayDesignatorFP>` : '');

  const departureDetails = depRwy
    ? `\n        <DepartureDetails>${runwayBlock(depRwy)}\n        </DepartureDetails>`
    : '';
  const arrivalDetails = arrRwy
    ? `\n        <ArrivalDetails>${runwayBlock(arrRwy)}\n        </ArrivalDetails>`
    : '';

  // Unique en-route User idents.
  const usedIds = new Set<string>();
  const wpXml = (plan.routeWaypoints ?? [])
    .map((wp, i) => {
      let id = sanitizeId(wp.name, `WP${i + 1}`);
      let n = 2;
      while (usedIds.has(id)) id = `${sanitizeId(wp.name, `WP${i + 1}`)}${n++}`;
      usedIds.add(id);
      return `        <ATCWaypoint id="${escapeXml(id)}">
            <ATCWaypointType>User</ATCWaypointType>
            <WorldPosition>${worldPos(wp.lat, wp.lng, cruiseFt)}</WorldPosition>
        </ATCWaypoint>`;
    })
    .join('\n');

  const title = `${plan.originIcao} - ${plan.destinationIcao}`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<SimBase.Document>
    <FlightPlan.FlightPlan>
        <DepartureID>${escapeXml(plan.originIcao)}</DepartureID>
        <DestinationID>${escapeXml(plan.destinationIcao)}</DestinationID>
        <Title>${escapeXml(title)}</Title>
        <Descr>${escapeXml(`${plan.originIcao} to ${plan.destinationIcao} created by FS Suite`)}</Descr>
        <FPType>${fpType}</FPType>
        <CruisingAlt>${Math.round(cruiseFt)}</CruisingAlt>
        <AppVersion>
            <AppVersionMajor>12</AppVersionMajor>
        </AppVersion>${departureDetails}
${wpXml}${arrivalDetails}
    </FlightPlan.FlightPlan>
</SimBase.Document>
`;
}

/** Export the Navigraph Charts PLN (`-charts.pln`). False if coords missing. */
export async function exportFlightPlanCharts(plan: VfrPlanData): Promise<boolean> {
  const xml = buildChartsPlnXml(plan);
  if (!xml) return false;
  await downloadOrShare(xml, `${plan.originIcao}-${plan.destinationIcao}-charts.pln`, 'application/xml');
  return true;
}

/** Shared web-download / native-share helper for text file exports. */
export async function downloadOrShare(content: string, filename: string, mime: string): Promise<void> {
  if (Platform.OS === 'web') {
    const blob = new Blob([content] as unknown as [Blob], { type: mime } as BlobOptions);
    const blobUrl = URL.createObjectURL(blob);
    const doc = (globalThis as unknown as {
      document: {
        createElement: (tag: string) => { href: string; download: string; rel: string; style: { display: string }; click: () => void };
        body: { appendChild: (n: unknown) => void; removeChild: (n: unknown) => void };
      };
    }).document;
    const anchor = doc.createElement('a');
    anchor.href = blobUrl;
    anchor.download = filename;
    anchor.rel = 'noopener';
    anchor.style.display = 'none';
    doc.body.appendChild(anchor);
    anchor.click();
    doc.body.removeChild(anchor);
    URL.revokeObjectURL(blobUrl);
    return;
  }

  const uri = `${FileSystem.documentDirectory ?? ''}${filename}`;
  await FileSystem.writeAsStringAsync(uri, content, { encoding: FileSystem.EncodingType.UTF8 });
  await Share.share({ url: uri, title: filename });
}
