import { BadRequestException, BadGatewayException, Injectable, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/node';

import { ActivityService } from '../../activity/activity.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';

import type { UpdateSimBriefConnectionDto } from './dto/update-simbrief-connection.dto';

const SIMBRIEF_API_URL = 'https://www.simbrief.com/api/xml.fetcher.php';
const SIMBRIEF_AIRFRAMES_URL = 'https://www.simbrief.com/api/inputs.airframes.json';
const CACHE_TTL_SECONDS = 300; // 5 minutes per spec §13
const AIRCRAFT_CACHE_TTL = 86400; // 24 hours — the list changes very rarely

export interface NavlogFix {
  ident: string;
  lat: number;
  lon: number;
  altitude: number;
  windDir: number;
  windSpeed: number;
  windComponent: number;
}

export interface SimBriefOfpResult {
  ofpId: string;
  originIcao: string;
  originName: string | null;
  originElevationFt: number | null;
  originRunway: string | null;
  destinationIcao: string;
  destinationName: string | null;
  destinationElevationFt: number | null;
  destinationRunway: string | null;
  alternateIcao: string | null;
  alternateName: string | null;
  alternateRunway: string | null;
  route: string | null;
  cruiseAltitudeFt: number | null;
  aircraftIcaoType: string | null;
  aircraftName: string | null;
  callsign: string | null;
  // Fuel (always kg — backend normalizes from SimBrief's params.units)
  fuelPlanRampKg: number | null;
  fuelTaxiKg: number | null;
  fuelEnrouteKg: number | null;
  fuelContingencyKg: number | null;
  fuelAlternateKg: number | null;
  fuelReserveKg: number | null;
  fuelMinTakeoffKg: number | null;
  fuelAvgFlowKgH: number | null;
  // Times
  flightTimeMinutes: number | null;
  // TOD
  todDistanceNm: number | null;
  // SID / STAR
  sid: string | null;
  star: string | null;
  // Total distance
  totalDistanceNm: number | null;
  // Wind aloft from navlog
  navlogFixes: NavlogFix[];
  // OFP files
  ofpPdfUrl: string | null;
  ofpHtml: string | null;
}

@Injectable()
export class SimBriefService {
  private readonly logger = new Logger(SimBriefService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly activity: ActivityService,
  ) {}

  async saveConnection(userId: string, dto: UpdateSimBriefConnectionDto): Promise<{ pilotId: string }> {
    await this.prisma.integrationConnection.upsert({
      where: { userId_service: { userId, service: 'simbrief' } },
      update: { externalId: dto.pilotId },
      create: { userId, service: 'simbrief', externalId: dto.pilotId },
    });

    void this.activity.log('simbrief.connection_updated', userId, { pilotId: dto.pilotId });

    return { pilotId: dto.pilotId };
  }

  async getConnection(userId: string): Promise<{ pilotId: string } | null> {
    const conn = await this.prisma.integrationConnection.findUnique({
      where: { userId_service: { userId, service: 'simbrief' } },
    });
    return conn?.externalId ? { pilotId: conn.externalId } : null;
  }

  async getAircraftList(): Promise<{ icao: string; name: string }[]> {
    const cacheKey = 'simbrief:aircraft_list';
    const client = this.redis.getClient();
    const cached = await client.get(cacheKey).catch(() => null);
    if (cached) {
      return JSON.parse(cached) as { icao: string; name: string }[];
    }

    let data: Record<string, { aircraft_icao?: string; aircraft_name?: string }>;
    try {
      const response = await fetch(SIMBRIEF_AIRFRAMES_URL);
      if (!response.ok) throw new Error(`SimBrief airframes API returned ${response.status}`);
      data = (await response.json()) as typeof data;
    } catch (err) {
      this.logger.error(`SimBrief airframes API error: ${err}`);
      throw new BadGatewayException('Could not fetch SimBrief aircraft list.');
    }

    const list = Object.values(data)
      .filter((a) => a.aircraft_icao && a.aircraft_name)
      .map((a) => ({ icao: a.aircraft_icao!, name: a.aircraft_name! }))
      .sort((a, b) => a.icao.localeCompare(b.icao));

    await client.setEx(cacheKey, AIRCRAFT_CACHE_TTL, JSON.stringify(list)).catch(() => {});
    return list;
  }

  async fetchOfp(userId: string): Promise<SimBriefOfpResult> {
    const conn = await this.getConnection(userId);
    if (!conn) {
      throw new BadRequestException(
        'No SimBrief pilot ID configured. Please set your pilot ID in your profile settings.',
      );
    }

    // Check Redis cache
    const cacheKey = `simbrief:ofp:${conn.pilotId}`;
    const client = this.redis.getClient();
    const cached = await client.get(cacheKey).catch(() => null);
    if (cached) {
      return JSON.parse(cached) as SimBriefOfpResult;
    }

    // Fetch from SimBrief API
    const url = `${SIMBRIEF_API_URL}?username=${encodeURIComponent(conn.pilotId)}&json=1`;

    let data: Record<string, unknown>;
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`SimBrief API returned ${response.status}`);
      }
      data = (await response.json()) as Record<string, unknown>;
    } catch (err) {
      this.logger.error(`SimBrief API error for pilot ${conn.pilotId}: ${err}`);
      Sentry.captureException(err, { tags: { service: 'simbrief', pilotId: conn.pilotId } });
      throw new BadGatewayException('SimBrief API is currently unavailable. Please try again later.');
    }

    // Normalize response
    const result = this.normalizeOfp(data);

    // Cache result
    await client.setEx(cacheKey, CACHE_TTL_SECONDS, JSON.stringify(result)).catch(() => {});

    void this.activity.log('simbrief.import', userId, { ofpId: result.ofpId, pilotId: conn.pilotId });

    return result;
  }

  private normalizeOfp(data: Record<string, unknown>): SimBriefOfpResult {
    const params = (data['params'] ?? {}) as Record<string, unknown>;
    const general = (data['general'] ?? {}) as Record<string, unknown>;
    const origin = (data['origin'] ?? {}) as Record<string, unknown>;
    const destination = (data['destination'] ?? {}) as Record<string, unknown>;
    const alternate = (data['alternate'] ?? {}) as Record<string, unknown>;
    const fuel = (data['fuel'] ?? {}) as Record<string, unknown>;
    const aircraft = (data['aircraft'] ?? {}) as Record<string, unknown>;
    const times = (data['times'] ?? {}) as Record<string, unknown>;
    const files = (data['files'] ?? {}) as Record<string, unknown>;
    const text = (data['text'] ?? {}) as Record<string, unknown>;
    const navlog = (data['navlog'] ?? {}) as Record<string, unknown>;
    const fixes = (Array.isArray(navlog['fix']) ? navlog['fix'] : []) as Record<string, unknown>[];

    // Find TOD fix in navlog
    const todFix = fixes.find((f) => f['is_sid_star'] === '4' || String(f['ident'] ?? '').toUpperCase() === 'TOD');
    let todDistanceNm: number | null = null;
    if (todFix && destination['icao_code']) {
      const totalDist = general['route_distance'] ? Number(general['route_distance']) : null;
      const todDist = todFix['distance'] ? Number(todFix['distance']) : null;
      if (totalDist && todDist) {
        todDistanceNm = Math.round(totalDist - todDist);
      }
    }

    // OFP PDF URL
    let ofpPdfUrl: string | null = null;
    if (files['directory']) {
      const dir = String(files['directory']);
      const pdfFile = files['pdf'] as Record<string, unknown> | undefined;
      if (pdfFile?.['link']) {
        ofpPdfUrl = `${dir}${pdfFile['link']}`;
      }
    }

    const n = (v: unknown): number | null => (v != null && v !== '' ? Number(v) : null);
    const s = (v: unknown): string | null => (v != null && v !== '' ? String(v) : null);

    // SimBrief fuel values follow params.units — normalize to kg
    const LBS_TO_KG = 0.453592;
    const isLbs = String(params['units'] ?? '').toLowerCase() === 'lbs';
    const toKg = (v: unknown): number | null => {
      const raw = n(v);
      if (raw == null) return null;
      return isLbs ? Math.round(raw * LBS_TO_KG) : Math.round(raw);
    };

    // Extract wind aloft from navlog waypoints
    const navlogFixes: NavlogFix[] = fixes
      .filter((f) => String(f['ident'] ?? '').length > 0)
      .map((f) => ({
        ident: String(f['ident']),
        lat: Number(f['pos_lat'] ?? 0),
        lon: Number(f['pos_long'] ?? 0),
        altitude: Number(f['altitude_feet'] ?? 0),
        windDir: Number(f['wind_dir'] ?? 0),
        windSpeed: Number(f['wind_spd'] ?? 0),
        windComponent: Number(f['wind_component'] ?? 0),
      }));

    return {
      ofpId: String(params['request_id'] ?? general['icao_airline'] ?? ''),
      originIcao: String(origin['icao_code'] ?? ''),
      originName: s(origin['name']),
      originElevationFt: n(origin['elevation']),
      originRunway: s(origin['plan_rwy']),
      destinationIcao: String(destination['icao_code'] ?? ''),
      destinationName: s(destination['name']),
      destinationElevationFt: n(destination['elevation']),
      destinationRunway: s(destination['plan_rwy']),
      alternateIcao: s(alternate['icao_code']),
      alternateName: s(alternate['name']),
      alternateRunway: s(alternate['plan_rwy']),
      route: s(general['route']),
      cruiseAltitudeFt: n(general['initial_altitude']),
      aircraftIcaoType: s(aircraft['icaocode']),
      aircraftName: s(aircraft['name']),
      callsign: s(general['flight_number']),
      fuelPlanRampKg: toKg(fuel['plan_ramp']),
      fuelTaxiKg: toKg(fuel['taxi']),
      fuelEnrouteKg: toKg(fuel['enroute_burn']),
      fuelContingencyKg: toKg(fuel['contingency']),
      fuelAlternateKg: toKg(fuel['alternate_burn']),
      fuelReserveKg: toKg(fuel['reserve']),
      fuelMinTakeoffKg: toKg(fuel['min_takeoff']),
      fuelAvgFlowKgH: toKg(fuel['avg_fuel_flow']),
      flightTimeMinutes: times['est_time_enroute'] ? Math.round(Number(times['est_time_enroute']) / 60) : null,
      todDistanceNm,
      sid: s(params['sid']),
      star: s(params['star']),
      totalDistanceNm: n(general['route_distance']),
      navlogFixes,
      ofpPdfUrl,
      ofpHtml: s(text['plan_html']),
    };
  }
}
