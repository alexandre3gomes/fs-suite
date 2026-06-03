import { BadRequestException, Injectable } from '@nestjs/common';
import type { Airport } from '@prisma/client';
import { XMLParser } from 'fast-xml-parser';

import { AirportsService } from '../../airports/airports.service';

interface FplPoint {
  ident: string;
  type: string;
  lat: number;
  lon: number;
}

/** An aerodrome resolved from our DB, in the shape the app's form expects. */
interface ResolvedAerodrome {
  icao: string;
  iata: string | null;
  name: string;
  city: string | null;
  country: string | null;
  latitude: number;
  longitude: number;
  elevation: number | null;
  type: string | null;
}

export interface FplImportResult {
  routeName: string | null;
  origin: ResolvedAerodrome | null;
  originIdent: string;
  destination: ResolvedAerodrome | null;
  destinationIdent: string;
  waypoints: { name: string; lat: number; lng: number }[];
  /** Idents (origin/destination) that aren't in our airport DB — user must pick. */
  unresolved: string[];
}

function toAerodrome(a: Airport): ResolvedAerodrome {
  return {
    icao: a.icao,
    iata: a.iata,
    name: a.name,
    city: a.city,
    country: a.country,
    latitude: a.latitude,
    longitude: a.longitude,
    elevation: a.elevation,
    type: a.type,
  };
}

@Injectable()
export class SkyVectorService {
  constructor(private readonly airports: AirportsService) {}

  buildUrl(originIcao: string, destinationIcao: string, route?: string): { url: string } {
    // SkyVector URL pattern: https://skyvector.com/?fpl=ORIGIN+WAYPOINT1+...+DESTINATION
    const parts = [originIcao.toUpperCase()];
    if (route) {
      const waypoints = route
        .split(/\s+/)
        .map((w) => w.trim().toUpperCase())
        .filter((w) => w.length > 0);
      parts.push(...waypoints);
    }
    parts.push(destinationIcao.toUpperCase());
    return { url: `https://skyvector.com/?fpl=${parts.join('+')}` };
  }

  /** Parse a Garmin FlightPlan v1 .fpl (what SkyVector exports) into ordered points. */
  parseFpl(xml: string): { routeName: string | null; points: FplPoint[] } {
    const parser = new XMLParser({ ignoreAttributes: true, parseTagValue: false, trimValues: true });
    let doc: Record<string, unknown>;
    try {
      doc = parser.parse(xml) as Record<string, unknown>;
    } catch {
      throw new BadRequestException('Arquivo inválido — não é um .fpl XML válido.');
    }
    const fp = (doc['flight-plan'] ?? doc['flightplan']) as Record<string, unknown> | undefined;
    if (!fp) throw new BadRequestException('Não é um plano de voo Garmin/SkyVector (.fpl).');

    // Build the ident → coordinates table.
    const wpTable = (fp['waypoint-table'] as Record<string, unknown> | undefined)?.['waypoint'];
    const wps = Array.isArray(wpTable) ? wpTable : wpTable ? [wpTable] : [];
    const table = new Map<string, FplPoint>();
    for (const w of wps as Record<string, unknown>[]) {
      const ident = String(w.identifier ?? '').trim();
      const lat = Number(w.lat);
      const lon = Number(w.lon);
      if (ident && Number.isFinite(lat) && Number.isFinite(lon)) {
        table.set(ident.toUpperCase(), { ident, type: String(w.type ?? ''), lat, lon });
      }
    }

    // Resolve the ordered route by ident → coords.
    const route = fp['route'] as Record<string, unknown> | undefined;
    const rp = route?.['route-point'];
    const rps = Array.isArray(rp) ? rp : rp ? [rp] : [];
    const points: FplPoint[] = [];
    for (const p of rps as Record<string, unknown>[]) {
      const ident = String(p['waypoint-identifier'] ?? '')
        .trim()
        .toUpperCase();
      const entry = table.get(ident);
      if (entry) points.push(entry);
    }
    if (points.length < 2) {
      throw new BadRequestException('Plano de voo com menos de 2 pontos reconhecíveis.');
    }
    const routeName = route?.['route-name'] != null ? String(route['route-name']) : null;
    return { routeName, points };
  }

  /** Import a .fpl: resolve origin/destination against our DB; mid points become waypoints. */
  async importFpl(xml: string): Promise<FplImportResult> {
    const { routeName, points } = this.parseFpl(xml);
    const first = points[0]!;
    const last = points[points.length - 1]!;
    const middle = points.slice(1, -1);

    const [originRow, destRow] = await Promise.all([
      this.airports.resolveByCode(first.ident),
      this.airports.resolveByCode(last.ident),
    ]);

    const unresolved: string[] = [];
    if (!originRow) unresolved.push(first.ident);
    if (!destRow) unresolved.push(last.ident);

    return {
      routeName,
      origin: originRow ? toAerodrome(originRow) : null,
      originIdent: first.ident,
      destination: destRow ? toAerodrome(destRow) : null,
      destinationIdent: last.ident,
      waypoints: middle.map((p) => ({ name: p.ident, lat: p.lat, lng: p.lon })),
      unresolved,
    };
  }
}
