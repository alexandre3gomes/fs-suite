import type { VfrPlanData } from '../components/vfr/VfrPlanForm';
import { parseCruiseLevelFt } from '../components/vfr/vfrNavigation';

import { downloadOrShare } from './pln-export';

// Little Navmap native `.lnmpln` export.
//
// Why a separate format: at AppVersionMajor 12 (which the MSFS web planner
// requires) LNM duplicates aerodromes listed both in DepartureID/DestinationID
// and as ATCWaypoints. LNM's own format has no such ambiguity AND carries the
// runway: LNM models a selected runway as a custom SID/Approach that adds a
// fix N NM off the threshold — encoded here in <Procedures>.

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Runway designation normalised to LNM form ("12", "16L"). */
function normalizeRunway(rwy?: string): string | null {
  if (!rwy) return null;
  const m = rwy.trim().toUpperCase().match(/^0?(\d{1,2})\s*([LRC])?$/);
  if (!m) return null;
  return `${parseInt(m[1]!, 10)}${m[2] ?? ''}`;
}

function pos(lon: number, lat: number, altFt: number): string {
  return `<Pos Lon="${lon.toFixed(6)}" Lat="${lat.toFixed(6)}" Alt="${altFt.toFixed(2)}"/>`;
}

/** Build the Little Navmap `.lnmpln` XML. Returns null if coords are missing. */
export function buildLnmPln(plan: VfrPlanData): string | null {
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
  const depRwy = normalizeRunway(plan.originRunwayInUse);
  const destRwy = normalizeRunway(plan.destinationRunwayInUse);

  // Custom departure/approach carrying the selected runways. LNM renders a fix
  // CustomDistance NM off each threshold (the "waypoint X NM from the runway").
  const procedures: string[] = [];
  if (depRwy) {
    procedures.push(`      <SID>
        <Name>${escapeXml(plan.originIcao + depRwy)}</Name>
        <Runway>${escapeXml(depRwy)}</Runway>
        <Type>CUSTOMDEPART</Type>
        <CustomDistance>1.00</CustomDistance>
      </SID>`);
  }
  if (destRwy) {
    procedures.push(`      <Approach>
        <Name>${escapeXml(plan.destinationIcao + destRwy)}</Name>
        <Runway>${escapeXml(destRwy)}</Runway>
        <Type>CUSTOM</Type>
        <CustomDistance>1.00</CustomDistance>
        <CustomAltitude>1000.00</CustomAltitude>
        <CustomOffsetAngle>0.00</CustomOffsetAngle>
      </Approach>`);
  }
  const proceduresXml = procedures.length > 0
    ? `    <Procedures>\n${procedures.join('\n')}\n    </Procedures>\n`
    : '';

  const wpNodes: string[] = [];
  wpNodes.push(`      <Waypoint>
        <Name>${escapeXml(plan.originName || plan.originIcao)}</Name>
        <Ident>${escapeXml(plan.originIcao)}</Ident>
        <Type>AIRPORT</Type>
        ${pos(oLon, oLat, depAlt)}
      </Waypoint>`);
  for (const wp of plan.routeWaypoints ?? []) {
    wpNodes.push(`      <Waypoint>
        <Ident>${escapeXml(wp.name)}</Ident>
        <Type>USER</Type>
        ${pos(wp.lng, wp.lat, cruiseFt)}
      </Waypoint>`);
  }
  wpNodes.push(`      <Waypoint>
        <Name>${escapeXml(plan.destinationName || plan.destinationIcao)}</Name>
        <Ident>${escapeXml(plan.destinationIcao)}</Ident>
        <Type>AIRPORT</Type>
        ${pos(dLon, dLat, destAlt)}
      </Waypoint>`);

  const aircraft = plan.aircraftType
    ? `    <AircraftPerformance>\n      <Type>${escapeXml(plan.aircraftType)}</Type>\n    </AircraftPerformance>\n`
    : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<LittleNavmap xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="https://www.littlenavmap.org/schema/lnmpln.xsd">
  <Flightplan>
    <Header>
      <FlightplanType>${fpType}</FlightplanType>
      <CruisingAlt>${Math.round(cruiseFt)}</CruisingAlt>
      <CruisingAltF>${cruiseFt.toFixed(8)}</CruisingAltF>
      <CreationDate>${new Date().toISOString()}</CreationDate>
      <FileVersion>1.2</FileVersion>
      <ProgramName>FS Suite</ProgramName>
      <ProgramVersion>1.0</ProgramVersion>
      <Documentation>https://www.littlenavmap.org/lnmpln.html</Documentation>
    </Header>
    <SimData>MSFS24</SimData>
${aircraft}${proceduresXml}    <Waypoints>
${wpNodes.join('\n')}
    </Waypoints>
  </Flightplan>
</LittleNavmap>
`;
}

/** Export the plan as a `.lnmpln` file. Returns false if coords are missing. */
export async function exportFlightPlanLnm(plan: VfrPlanData): Promise<boolean> {
  const xml = buildLnmPln(plan);
  if (!xml) return false;
  await downloadOrShare(xml, `${plan.originIcao}-${plan.destinationIcao}.lnmpln`, 'application/xml');
  return true;
}
