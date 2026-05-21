import type {
  CrosswindAnalysis,
  MetarCloud,
  ParsedMetar,
  ParsedTaf,
  SigmetCollection,
  SigmetHazardType,
  TafForecastPeriod,
} from '@fs-suite/types';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { haversineNm as geoHaversineNm, initialBearing } from '../common/geo.utils';
import { cruiseLevelToFeet, windTriangle } from '../common/wind.utils';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

import { decodeMetarToPtBr } from './metar-decoder';
import {
  assessSafety,
  checkAerodrome,
  findSigmetHazardSegments,
  type HazardSegment,
  type PerformanceAdjustments,
  type SafetyAssessment,
  type SafetyCheckParams,
  type SigmetFeature,
  type ValidationItem,
} from './safety-checker';

export type { SafetyAssessment } from './safety-checker';

export interface FlightCategoryResult {
  icao: string;
  flightCategory: string | null;
  derived: boolean;
  referenceStation?: string;
  referenceDistanceNm?: number;
}

export interface RouteSafetyResponse {
  items: { id: string; severity: string; message: string; action?: string; source?: string }[];
  performanceAdjustments?: PerformanceAdjustments;
  hazardSegments: { fromIdx: number; toIdx: number; hazardType: string; severity: string }[];
}

const METAR_API_URL = 'https://aviationweather.gov/api/data/metar';
const TAF_API_URL = 'https://aviationweather.gov/api/data/taf';
const NOAA_TEXT_URL = 'https://tgftp.nws.noaa.gov/data/observations/metar/stations';
const REQUEST_TIMEOUT_MS = 8000;
const ISIGMET_API_URL = 'https://aviationweather.gov/api/data/isigmet?format=geojson';
const AIRSIGMET_API_URL = 'https://aviationweather.gov/api/data/airsigmet?format=geojson';
const SIGMET_CACHE_KEY = 'weather:sigmets';

function toIsoSafe(value: unknown): string {
  if (!value) return '';
  if (typeof value === 'string') return new Date(value).toISOString();
  if (typeof value === 'number') return new Date(value * 1000).toISOString();
  return '';
}

function parseSigmetStatus(raw: string): 'OBS' | 'FCST' | null {
  if (/\bOBS\b/.test(raw)) return 'OBS';
  if (/\bFCST\b/.test(raw)) return 'FCST';
  return null;
}

// Differentiated cache TTLs
const METAR_CACHE_TTL = 600; // 10 minutes
const TAF_CACHE_TTL = 3600; // 1 hour — TAFs change infrequently
const SIGMET_CACHE_TTL = 600; // 10 minutes — safety-critical
const AVWX_CACHE_TTL = 600; // 10 minutes
const ROUTE_IMPACT_CACHE_TTL = 600; // 10 minutes
const WINDS_ALOFT_CACHE_TTL = 1800; // 30 minutes — upper winds change slowly
const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast';
const OPEN_METEO_PRESSURE_LEVELS = [1000, 975, 950, 925, 900, 850, 800, 700, 600, 500, 400, 300, 250, 200] as const;
const AVGAS_DENSITY_KG_L = 0.72;

export type {
  CrosswindAnalysis,
  MetarCloud,
  ParsedMetar,
  ParsedTaf,
  SigmetCollection,
  TafForecastPeriod,
} from '@fs-suite/types';

// ICAO present weather phenomena lookup
const PRESENT_WEATHER_RE =
  /^([+-])?(?:MI|BC|PR|DR|BL|SH|TS|FZ)?(?:DZ|RA|SN|SG|IC|PL|GR|GS|UP|BR|FG|FU|VA|DU|SA|HZ|PY|PO|SQ|FC|SS|DS)+$/;

interface AddsMetarResponse {
  icaoId: string;
  rawOb: string;
  reportTime: string;
  wdir: number | string;
  wspd: number;
  wgst?: number;
  visib: string;
  altim: number;
  temp: number;
  dewp: number;
  clouds: { cover: string; base: number }[];
  fltCat: string;
}


interface AddsTafResponse {
  icaoId: string;
  rawTAF: string;
  issueTime: string;
  validTimeFrom: number;
  validTimeTo: number;
  fcsts: {
    timeFrom: number;
    timeTo: number;
    timeBec: number | null;
    fcstChange: string | null;
    probability: number | null;
    wdir: number;
    wspd: number;
    wgst: number | null;
    visib: number | string;
    wxString: string | null;
    clouds: { cover: string; base: number | null; type: string | null }[];
  }[];
}


@Injectable()
export class WeatherService {
  private readonly logger = new Logger(WeatherService.name);

  constructor(
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async getFlightCategories(icaos: string[]): Promise<FlightCategoryResult[]> {
    if (icaos.length === 0) return [];

    const normalized = icaos.map((c) => c.toUpperCase().trim()).filter((c) => /^[A-Z]{4}$/.test(c));
    if (normalized.length === 0) return [];

    const client = this.redis.getClient();
    const own = new Map<string, string>();
    const missing: string[] = [];

    // 1) Cache (Redis TTL handles freshness; obs age is user-facing info, not discard criteria)
    for (const icao of normalized) {
      const cached = await client.get(`metar:${icao}`).catch(() => null);
      if (cached) {
        const parsed = JSON.parse(cached) as ParsedMetar;
        if (parsed.flightCategory) {
          own.set(icao, parsed.flightCategory);
          continue;
        }
      }
      missing.push(icao);
    }

    // 2) Batch ADDS for missing
    if (missing.length > 0) {
      try {
        const url = `${METAR_API_URL}?ids=${missing.join(',')}&format=json`;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeout);

        if (response.ok) {
          const data = (await response.json()) as AddsMetarResponse[];
          for (const entry of data) {
            const parsed = this.parseAddsResponse(entry);
            await client.setEx(`metar:${parsed.icaoId}`, METAR_CACHE_TTL, JSON.stringify(parsed)).catch(() => {});
            if (parsed.flightCategory) own.set(parsed.icaoId, parsed.flightCategory);
          }
        }
      } catch (err) {
        this.logger.warn(`ADDS flight-category batch fetch failed: ${err}`);
      }
    }

    // 3) Regional bbox for ICAOs still without own METAR
    const derived = new Map<string, { cat: string; station: string; distNm: number }>();
    const stillMissing = normalized.filter((icao) => !own.has(icao));

    if (stillMissing.length > 0) {
      try {
        const airports = await this.prisma.airport.findMany({
          where: { icao: { in: stillMissing } },
          select: { icao: true, latitude: true, longitude: true },
        });

        if (airports.length > 0) {
          const lats = airports.map((a) => a.latitude);
          const lons = airports.map((a) => a.longitude);
          const margin = 1.5;
          const bbox = `${Math.min(...lats) - margin},${Math.min(...lons) - margin},${Math.max(...lats) + margin},${Math.max(...lons) + margin}`;

          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
          const response = await fetch(`${METAR_API_URL}?bbox=${bbox}&format=json`, { signal: controller.signal });
          clearTimeout(timeout);

          if (response.ok) {
            const regionStations = (await response.json()) as (AddsMetarResponse & { lat: number; lon: number })[];

            if (regionStations.length > 0) {
              const airportMap = new Map(airports.map((a) => [a.icao, a]));
              for (const icao of stillMissing) {
                const ap = airportMap.get(icao);
                if (!ap) continue;

                let bestCat: string | null = null;
                let bestStation = '';
                let bestDist = Infinity;
                for (const st of regionStations) {
                  const d = geoHaversineNm(ap.latitude, ap.longitude, st.lat, st.lon);
                  if (d < bestDist) {
                    bestDist = d;
                    bestCat = st.fltCat ?? null;
                    bestStation = st.icaoId;
                  }
                }
                if (bestCat && bestStation) {
                  derived.set(icao, { cat: bestCat, station: bestStation, distNm: Math.round(bestDist) });
                }
              }
            }
          }
        }
      } catch (err) {
        this.logger.warn(`Regional bbox flight-category fetch failed: ${err}`);
      }
    }

    return normalized.map((icao) => {
      const ownCat = own.get(icao);
      if (ownCat) return { icao, flightCategory: ownCat, derived: false };

      const ref = derived.get(icao);
      if (ref) return { icao, flightCategory: ref.cat, derived: true, referenceStation: ref.station, referenceDistanceNm: ref.distNm };

      return { icao, flightCategory: null, derived: false };
    });
  }

  async getMetars(icaos: string[]): Promise<ParsedMetar[]> {
    if (icaos.length === 0) return [];

    const normalized = icaos.map((c) => c.toUpperCase().trim()).filter((c) => /^[A-Z]{4}$/.test(c));
    if (normalized.length === 0) return [];

    const client = this.redis.getClient();
    const results: ParsedMetar[] = [];
    const missing: string[] = [];

    for (const icao of normalized) {
      const cached = await client.get(`metar:${icao}`).catch(() => null);
      if (cached) {
        results.push(JSON.parse(cached) as ParsedMetar);
      } else {
        missing.push(icao);
      }
    }

    if (missing.length === 0) return results;

    // 1) Primary: AviationWeather.gov ADDS JSON API (batch)
    const addsFound = new Set<string>();
    try {
      const url = `${METAR_API_URL}?ids=${missing.join(',')}&format=json`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);

      if (response.ok) {
        const data = (await response.json()) as AddsMetarResponse[];
        for (const entry of data) {
          const parsed = this.parseAddsResponse(entry);
          await client.setEx(`metar:${parsed.icaoId}`, METAR_CACHE_TTL, JSON.stringify(parsed)).catch(() => {});
          results.push(parsed);
          addsFound.add(parsed.icaoId);
        }
      } else {
        this.logger.warn(`ADDS API returned ${response.status}`);
      }
    } catch (err) {
      this.logger.warn(`ADDS METAR fetch failed: ${err}`);
    }

    // 2) Fallback: NOAA text files for ICAOs not found in ADDS
    const stillMissing = missing.filter((icao) => !addsFound.has(icao));
    const noaaFound = new Set<string>();
    if (stillMissing.length > 0) {
      const noaaResults = await Promise.allSettled(
        stillMissing.map((icao) => this.fetchNoaaTextMetar(icao)),
      );
      for (const result of noaaResults) {
        if (result.status === 'fulfilled' && result.value) {
          const parsed = result.value;
          await client.setEx(`metar:${parsed.icaoId}`, METAR_CACHE_TTL, JSON.stringify(parsed)).catch(() => {});
          results.push(parsed);
          noaaFound.add(parsed.icaoId);
        }
      }
    }

    // 3) Nearby fallback: for ICAOs still without METAR, find nearest reporting station
    const finalMissing = stillMissing.filter((icao) => !noaaFound.has(icao));
    if (finalMissing.length > 0) {
      const nearbyResults = await Promise.allSettled(
        finalMissing.map((icao) => this.fetchNearbyMetar(icao)),
      );
      for (const result of nearbyResults) {
        if (result.status === 'fulfilled' && result.value) {
          const parsed = result.value;
          await client.setEx(`metar:${parsed.icaoId}`, METAR_CACHE_TTL, JSON.stringify(parsed)).catch(() => {});
          results.push(parsed);
        }
      }
    }

    const ordered = normalized
      .map((icao) => results.find((r) => r.icaoId === icao))
      .filter((r): r is ParsedMetar => r != null);

    // Enrich with decoded text (AVWX if available, else pt-BR decoder)
    await this.enrichWithDecodedText(ordered);

    return ordered;
  }

  private async enrichWithDecodedText(metars: ParsedMetar[]): Promise<void> {
    const client = this.redis.getClient();
    const needsEnrichment = metars.filter((m) => !m.decodedText);
    if (needsEnrichment.length === 0) return;

    const avwxResults = await Promise.all(
      needsEnrichment.map((m) => this.fetchAvwxDecoded(m.icaoId)),
    );

    for (let i = 0; i < needsEnrichment.length; i++) {
      const metar = needsEnrichment[i]!;
      metar.decodedText = avwxResults[i] ?? decodeMetarToPtBr(metar);
      await client.setEx(`metar:${metar.icaoId}`, METAR_CACHE_TTL, JSON.stringify(metar)).catch(() => {});
    }
  }

  private async fetchAvwxDecoded(icao: string): Promise<string | null> {
    const token = this.config.get<string>('AVWX_TOKEN');
    if (!token) return null;

    const client = this.redis.getClient();
    const cacheKey = `avwx:metar:${icao}`;
    const cached = await client.get(cacheKey).catch(() => null);
    if (cached) return cached;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      const response = await fetch(
        `https://avwx.rest/api/metar/${icao}?options=info,translate`,
        { signal: controller.signal, headers: { Authorization: `BEARER ${token}` } },
      );
      clearTimeout(timeout);

      if (!response.ok) {
        this.logger.warn(`AVWX returned ${response.status} for ${icao}`);
        return null;
      }

      const data = (await response.json()) as { translate?: { english?: string } };
      const decoded = data.translate?.english ?? null;
      if (decoded) {
        await client.setEx(cacheKey, AVWX_CACHE_TTL, decoded).catch(() => {});
      }
      return decoded;
    } catch (err) {
      this.logger.warn(`AVWX fetch failed for ${icao}: ${err}`);
      return null;
    }
  }

  async getCrosswind(icao: string): Promise<CrosswindAnalysis> {
    const code = icao.toUpperCase().trim();

    const [metars, airport] = await Promise.all([
      this.getMetars([code]),
      this.prisma.airport.findUnique({
        where: { icao: code },
        include: { runways: true },
      }),
    ]);

    const metar = metars[0];
    const windDir = metar?.windDirection ?? null;
    const windSpd = metar?.windSpeed ?? null;
    const windGust = metar?.windGust ?? null;
    const numericDir = typeof windDir === 'number' ? windDir : null;
    const ws = windSpd ?? 0;

    const runwayComponents: { ident: string; headwindKts: number; crosswindKts: number }[] = [];

    for (const rwy of airport?.runways ?? []) {
      if (rwy.closed) continue;
      const thresholds = [
        { ident: rwy.leIdent, heading: rwy.leHeadingDeg },
        { ident: rwy.heIdent, heading: rwy.heHeadingDeg },
      ];
      for (const t of thresholds) {
        if (!t.ident || t.heading == null || numericDir == null) continue;
        const diffRad = ((numericDir - t.heading) * Math.PI) / 180;
        runwayComponents.push({
          ident: t.ident,
          headwindKts: Math.round(ws * Math.cos(diffRad) * 10) / 10,
          crosswindKts: Math.round(Math.abs(ws * Math.sin(diffRad)) * 10) / 10,
        });
      }
    }

    runwayComponents.sort((a, b) => b.headwindKts - a.headwindKts);

    return {
      icao: code,
      windDirection: numericDir,
      windSpeed: windSpd,
      windGust,
      runways: runwayComponents,
      suggested: runwayComponents[0]?.ident ?? null,
    };
  }

  async getTafs(icaos: string[]): Promise<ParsedTaf[]> {
    if (icaos.length === 0) return [];

    const normalized = icaos.map((c) => c.toUpperCase().trim()).filter((c) => /^[A-Z]{4}$/.test(c));
    if (normalized.length === 0) return [];

    const client = this.redis.getClient();
    const results: ParsedTaf[] = [];
    const missing: string[] = [];

    for (const icao of normalized) {
      const cached = await client.get(`taf:${icao}`).catch(() => null);
      if (cached) {
        results.push(JSON.parse(cached) as ParsedTaf);
      } else {
        missing.push(icao);
      }
    }

    if (missing.length === 0) return results;

    try {
      const url = `${TAF_API_URL}?ids=${missing.join(',')}&format=json`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);

      if (!response.ok) {
        this.logger.warn(`ADDS TAF API returned ${response.status}`);
        return results;
      }

      const data = (await response.json()) as AddsTafResponse[];

      for (const entry of data) {
        const parsed = this.parseAddsTafResponse(entry);
        await client
          .setEx(`taf:${parsed.icaoId}`, TAF_CACHE_TTL, JSON.stringify(parsed))
          .catch(() => {});
        results.push(parsed);
      }
    } catch (err) {
      this.logger.warn(`Failed to fetch TAF for ${missing.join(',')}: ${err}`);
    }

    return normalized
      .map((icao) => results.find((r) => r.icaoId === icao))
      .filter((r): r is ParsedTaf => r != null);
  }

  // --------------- SIGMETs / AIRMETs ---------------

  async getSigmets(): Promise<SigmetCollection> {
    const client = this.redis.getClient();
    const cached = await client.get(SIGMET_CACHE_KEY).catch(() => null);
    if (cached) {
      return JSON.parse(cached);
    }

    const features: SigmetCollection['features'] = [];

    // International SIGMETs
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      const response = await fetch(ISIGMET_API_URL, { signal: controller.signal });
      clearTimeout(timeout);

      if (response.ok) {
        const data = await response.json();
        for (const f of data.features ?? []) {
          const p = f.properties ?? {};
          if (!f.geometry) continue;
          features.push({
            type: 'Feature',
            geometry: f.geometry,
            properties: {
              id: p.isigmetId ?? '',
              hazardType: this.normalizeHazardType(p.hazard),
              rawText: p.rawSigmet ?? '',
              qualifier: p.qualifier ?? null,
              validFrom: toIsoSafe(p.validTimeFrom),
              validTo: toIsoSafe(p.validTimeTo),
              firId: p.firId ?? p.icaoId ?? null,
              sigmetType: 'SIGMET',
              status: parseSigmetStatus(p.rawSigmet ?? ''),
              baseFt: typeof p.base === 'number' ? p.base : null,
              topFt: typeof p.top === 'number' ? p.top : null,
              movementDir: typeof p.dir === 'number' ? p.dir : null,
              movementSpd: typeof p.spd === 'number' ? p.spd : null,
            },
          });
        }
      }
    } catch (err) {
      this.logger.warn(`ISIGMET fetch failed: ${err}`);
    }

    // US AIRSIGMETs
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      const response = await fetch(AIRSIGMET_API_URL, { signal: controller.signal });
      clearTimeout(timeout);

      if (response.ok) {
        const data = await response.json();
        for (const f of data.features ?? []) {
          const p = f.properties ?? {};
          if (!f.geometry) continue;
          features.push({
            type: 'Feature',
            geometry: f.geometry,
            properties: {
              id: p.airsigmetId ?? '',
              hazardType: this.normalizeHazardType(p.hazard),
              rawText: p.rawAirSigmet ?? '',
              qualifier: p.qualifier ?? null,
              validFrom: toIsoSafe(p.validTimeFrom),
              validTo: toIsoSafe(p.validTimeTo),
              firId: null,
              sigmetType: p.airsigmetType === 'AIRMET' ? 'AIRMET' : 'SIGMET',
              status: parseSigmetStatus(p.rawAirSigmet ?? ''),
              baseFt: typeof p.altitudeLo1 === 'number' ? p.altitudeLo1 : null,
              topFt: typeof p.altitudeHi1 === 'number' ? p.altitudeHi1 : null,
              movementDir: typeof p.movementDir === 'number' ? p.movementDir : null,
              movementSpd: typeof p.movementSpd === 'number' ? p.movementSpd : null,
            },
          });
        }
      }
    } catch (err) {
      this.logger.warn(`AIRSIGMET fetch failed: ${err}`);
    }

    const collection: SigmetCollection = { type: 'FeatureCollection', features };
    await client.setEx(SIGMET_CACHE_KEY, SIGMET_CACHE_TTL, JSON.stringify(collection)).catch(() => {});
    return collection;
  }

  async getRouteWeatherImpact(
    waypoints: { lat: number; lon: number }[],
    altitude: number,
  ): Promise<{
    waypoints: {
      lat: number;
      lon: number;
      nearestStation: string | null;
      distanceNm: number | null;
      flightCategory: string | null;
      ceiling: number | null;
      visibility: string | null;
      windDirection: number | string | null;
      windSpeed: number | null;
      presentWeather: string[];
    }[];
  }> {
    const client = this.redis.getClient();
    const cacheKey = `weather:route:${JSON.stringify(waypoints)}:${altitude}`;
    const cached = await client.get(cacheKey).catch(() => null);
    if (cached) return JSON.parse(cached);

    const result: {
      lat: number;
      lon: number;
      nearestStation: string | null;
      distanceNm: number | null;
      flightCategory: string | null;
      ceiling: number | null;
      visibility: string | null;
      windDirection: number | string | null;
      windSpeed: number | null;
      presentWeather: string[];
    }[] = [];

    for (const wp of waypoints) {
      const delta = 1.0;
      const bbox = `${wp.lat - delta},${wp.lon - delta},${wp.lat + delta},${wp.lon + delta}`;

      try {
        const url = `${METAR_API_URL}?bbox=${bbox}&format=json`;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeout);

        if (!response.ok) {
          result.push({ ...wp, nearestStation: null, distanceNm: null, flightCategory: null, ceiling: null, visibility: null, windDirection: null, windSpeed: null, presentWeather: [] });
          continue;
        }

        const data = (await response.json()) as (AddsMetarResponse & { lat: number; lon: number })[];
        if (data.length === 0) {
          result.push({ ...wp, nearestStation: null, distanceNm: null, flightCategory: null, ceiling: null, visibility: null, windDirection: null, windSpeed: null, presentWeather: [] });
          continue;
        }

        let nearest = data[0]!;
        let nearestDist = this.haversineNm(wp.lat, wp.lon, nearest.lat, nearest.lon);
        for (let i = 1; i < data.length; i++) {
          const d = this.haversineNm(wp.lat, wp.lon, data[i]!.lat, data[i]!.lon);
          if (d < nearestDist) {
            nearest = data[i]!;
            nearestDist = d;
          }
        }

        const parsed = this.parseAddsResponse(nearest);
        result.push({
          ...wp,
          nearestStation: parsed.icaoId,
          distanceNm: Math.round(nearestDist * 10) / 10,
          flightCategory: parsed.flightCategory,
          ceiling: parsed.ceiling,
          visibility: parsed.visibility,
          windDirection: parsed.windDirection,
          windSpeed: parsed.windSpeed,
          presentWeather: parsed.presentWeather ?? [],
        });
      } catch {
        result.push({ ...wp, nearestStation: null, distanceNm: null, flightCategory: null, ceiling: null, visibility: null, windDirection: null, windSpeed: null, presentWeather: [] });
      }
    }

    const response = { waypoints: result };
    await client.setEx(cacheKey, ROUTE_IMPACT_CACHE_TTL, JSON.stringify(response)).catch(() => {});
    return response;
  }

  async assessFlightPlanSafety(plan: {
    originIcao: string | null;
    destinationIcao: string | null;
    alternateIcao: string | null;
    cruiseLevel: string | null;
    fuelCurrentTotal: number | null;
    fuelRequiredTotal: number | null;
    takeoffWeightKg: number | null;
    mtowKg: number | null;
    todDistanceNm: number | null;
    totalDistanceNm: number | null;
    groundSpeed: number | null;
    enduranceMinutes: number | null;
    fuelReserveMinutes: number | null;
    plannedDepartureUtc: Date | null;
    estimatedElapsedMin: number | null;
    estimatedArrivalUtc: Date | null;
    routes?: { latitude: number | null; longitude: number | null; sequence: number }[];
    cruiseSpeedKts?: number | null;
    fuelBurnLph?: number | null;
  }): Promise<SafetyAssessment> {
    const icaos = [plan.originIcao, plan.destinationIcao, plan.alternateIcao].filter(
      (v): v is string => v != null,
    );

    const routeWaypoints = (plan.routes ?? [])
      .sort((a, b) => a.sequence - b.sequence)
      .filter((r): r is typeof r & { latitude: number; longitude: number } =>
        r.latitude != null && r.longitude != null,
      )
      .map((r) => ({ lat: r.latitude, lon: r.longitude }));

    const fetchSigmets = routeWaypoints.length >= 2;

    const [metarList, tafList, sigmetCollection] = await Promise.all([
      this.getMetars(icaos),
      this.getTafs(icaos),
      fetchSigmets ? this.getSigmets() : Promise.resolve({ type: 'FeatureCollection' as const, features: [] }),
    ]);

    const metars: Record<string, ParsedMetar> = {};
    for (const m of metarList) metars[m.icaoId] = m;

    const tafs: Record<string, ParsedTaf> = {};
    for (const t of tafList) tafs[t.icaoId] = t;

    // Use persisted departure time if available, otherwise fall back to now
    const depEpochSec = plan.plannedDepartureUtc
      ? Math.floor(plan.plannedDepartureUtc.getTime() / 1000)
      : Math.floor(Date.now() / 1000);
    const depMs = depEpochSec * 1000;

    // Use persisted total distance (real route distance), NOT todDistanceNm
    const totalDistanceNm = plan.totalDistanceNm ?? 0;
    const cruiseSpeedKts = plan.groundSpeed ?? null;
    const enduranceMin = plan.enduranceMinutes ?? 0;

    // Use persisted ETE/ETA if available, otherwise compute from speed+distance
    const arrEpochSec = plan.estimatedArrivalUtc
      ? Math.floor(plan.estimatedArrivalUtc.getTime() / 1000)
      : (plan.estimatedElapsedMin
        ? depEpochSec + plan.estimatedElapsedMin * 60
        : (cruiseSpeedKts && totalDistanceNm > 0
          ? depEpochSec + Math.round((totalDistanceNm / cruiseSpeedKts) * 3600)
          : null));

    const reserveMin = plan.fuelReserveMinutes ?? 30;
    const fuelOnBoard = plan.fuelCurrentTotal ?? 0;
    const fuelRequired = plan.fuelRequiredTotal ?? 0;
    const cruiseAltFt = plan.cruiseLevel ? cruiseLevelToFeet(plan.cruiseLevel) : null;

    const validSigmets: SigmetFeature[] = sigmetCollection.features
      .filter((f) => {
        const from = new Date(f.properties.validFrom).getTime();
        const to = new Date(f.properties.validTo).getTime();
        return depMs >= from && depMs < to && f.geometry != null;
      })
      .map((f) => ({ geometry: f.geometry, properties: f.properties }));

    const params: SafetyCheckParams = {
      originIcao: plan.originIcao,
      destinationIcao: plan.destinationIcao,
      alternateIcao: plan.alternateIcao,
      cruiseLevel: plan.cruiseLevel,
      fuelOnBoardKg: fuelOnBoard,
      minFuelKg: fuelRequired,
      takeoffWeightKg: plan.takeoffWeightKg,
      mtowKg: plan.mtowKg,
      totalDistanceNm,
      cruiseSpeedKts,
      enduranceMin,
      flightCondition: reserveMin >= 45 ? 'night' : 'day',
      departureEpochSec: depEpochSec,
      arrivalEpochSec: arrEpochSec,
      alternateArrivalEpochSec: arrEpochSec && cruiseSpeedKts && plan.todDistanceNm
        ? arrEpochSec + Math.round((plan.todDistanceNm / cruiseSpeedKts) * 3600)
        : null,
      metars,
      tafs,
      routeWaypoints: routeWaypoints.length >= 2 ? routeWaypoints : undefined,
      sigmets: validSigmets.length > 0 ? validSigmets : undefined,
      cruiseAltitudeFt: cruiseAltFt,
    };

    const assessment = assessSafety(params);

    let performanceAdjustments: PerformanceAdjustments | undefined;
    const tas = plan.cruiseSpeedKts ?? cruiseSpeedKts;
    const fuelBurnLph = plan.fuelBurnLph;

    if (routeWaypoints.length >= 2 && cruiseAltFt && tas && tas > 0) {
      try {
        const winds = await this.getWindsAloft(routeWaypoints, cruiseAltFt, depEpochSec);
        performanceAdjustments = this.computePerformanceAdjustments(
          routeWaypoints, winds, tas, totalDistanceNm, fuelBurnLph ?? null,
        );
      } catch (err) {
        this.logger.warn(`Winds aloft fetch failed, skipping performance adjustments: ${err}`);
      }
    }

    return { ...assessment, performanceAdjustments };
  }

  async assessRouteSafety(params: {
    waypoints: { lat: number; lon: number }[];
    originIcao: string | null;
    destinationIcao: string | null;
    alternateIcao: string | null;
    cruiseLevel: string | null;
    cruiseSpeedKts: number | null;
    fuelBurnLph: number | null;
    totalDistanceNm: number;
    departureEpochSec: number | null;
    arrivalEpochSec: number | null;
  }): Promise<RouteSafetyResponse> {
    const {
      waypoints, originIcao, destinationIcao, alternateIcao,
      cruiseLevel, cruiseSpeedKts, fuelBurnLph, totalDistanceNm,
      departureEpochSec, arrivalEpochSec,
    } = params;

    const items: RouteSafetyResponse['items'] = [];
    let hazardSegments: HazardSegment[] = [];
    let performanceAdjustments: PerformanceAdjustments | undefined;

    const cruiseAltFt = cruiseLevel ? cruiseLevelToFeet(cruiseLevel) : null;
    const nowMs = Date.now();
    const nowSec = Math.floor(nowMs / 1000);
    const depSec = departureEpochSec ?? nowSec;
    const arrSec = arrivalEpochSec;

    const icaos = [originIcao, destinationIcao, alternateIcao].filter((v): v is string => v != null);
    const hasRoute = waypoints.length >= 2;

    const [metarList, tafList, sigmetCollection] = await Promise.all([
      icaos.length > 0 ? this.getMetars(icaos) : Promise.resolve([]),
      icaos.length > 0 ? this.getTafs(icaos) : Promise.resolve([]),
      hasRoute ? this.getSigmets() : Promise.resolve({ type: 'FeatureCollection' as const, features: [] }),
    ]);

    const metars: Record<string, ParsedMetar> = {};
    for (const m of metarList) metars[m.icaoId] = m;
    const tafs: Record<string, ParsedTaf> = {};
    for (const t of tafList) tafs[t.icaoId] = t;

    // Aerodrome weather checks
    if (originIcao) {
      const wxItems: ValidationItem[] = [];
      checkAerodrome(originIcao, metars[originIcao] ?? null, tafs[originIcao] ?? null, depSec, 'origin', wxItems);
      for (const wi of wxItems) {
        items.push({ id: wi.id, severity: wi.severity, message: wi.message, action: wi.action, source: wi.source });
      }
    }
    if (destinationIcao && arrSec) {
      const wxItems: ValidationItem[] = [];
      checkAerodrome(destinationIcao, metars[destinationIcao] ?? null, tafs[destinationIcao] ?? null, arrSec, 'dest', wxItems);
      for (const wi of wxItems) {
        items.push({ id: wi.id, severity: wi.severity, message: wi.message, action: wi.action, source: wi.source });
      }
    }
    if (alternateIcao && arrSec) {
      const altArrSec = cruiseSpeedKts && totalDistanceNm > 0
        ? arrSec + Math.round((totalDistanceNm * 0.3 / cruiseSpeedKts) * 3600)
        : arrSec;
      const wxItems: ValidationItem[] = [];
      checkAerodrome(alternateIcao, metars[alternateIcao] ?? null, tafs[alternateIcao] ?? null, altArrSec, 'alternate', wxItems);
      for (const wi of wxItems) {
        items.push({ id: wi.id, severity: wi.severity, message: wi.message, action: wi.action, source: wi.source });
      }
    }

    // SIGMET route intersection (with per-segment data)
    if (hasRoute) {
      const validSigmets: SigmetFeature[] = sigmetCollection.features
        .filter((f) => {
          const from = new Date(f.properties.validFrom).getTime();
          const to = new Date(f.properties.validTo).getTime();
          return nowMs >= from && nowMs < to && f.geometry != null;
        })
        .map((f) => ({ geometry: f.geometry, properties: f.properties }));

      if (validSigmets.length > 0) {
        const result = findSigmetHazardSegments(waypoints, validSigmets, cruiseAltFt);
        for (const si of result.items) {
          items.push({ id: si.id, severity: si.severity, message: si.message, source: si.source });
        }
        hazardSegments = result.segments;
      }
    }

    // Winds aloft + performance adjustments
    if (hasRoute && cruiseAltFt && cruiseSpeedKts && cruiseSpeedKts > 0) {
      try {
        const winds = await this.getWindsAloft(waypoints, cruiseAltFt, nowSec);
        performanceAdjustments = this.computePerformanceAdjustments(
          waypoints, winds, cruiseSpeedKts, totalDistanceNm, fuelBurnLph,
        );
      } catch (err) {
        this.logger.warn(`Winds aloft fetch failed: ${err}`);
      }
    }

    return { items, performanceAdjustments, hazardSegments };
  }

  // --------------- Winds Aloft (Open-Meteo) ---------------

  private altitudeFtToPressureLevel(altFt: number): number {
    const altM = altFt * 0.3048;
    const pressure = 1013.25 * Math.pow(1 - 2.25577e-5 * altM, 5.25588);
    let best: number = OPEN_METEO_PRESSURE_LEVELS[0];
    let bestDiff = Math.abs(pressure - best);
    for (const level of OPEN_METEO_PRESSURE_LEVELS) {
      const diff = Math.abs(pressure - level);
      if (diff < bestDiff) { best = level; bestDiff = diff; }
    }
    return best;
  }

  async getWindsAloft(
    points: { lat: number; lon: number }[],
    altitudeFt: number,
    targetEpochSec: number,
  ): Promise<{ lat: number; lon: number; windDir: number; windSpd: number }[]> {
    const level = this.altitudeFtToPressureLevel(altitudeFt);
    const client = this.redis.getClient();

    const gridStep = 0.25;
    const round = (v: number): number => Math.round(v / gridStep) * gridStep;

    interface GridCell { rLat: number; rLon: number; key: string }
    const cells: GridCell[] = points.map((p) => {
      const rLat = round(p.lat);
      const rLon = round(p.lon);
      return { rLat, rLon, key: `winds:${rLat}:${rLon}:${level}` };
    });

    const uniqueKeys = [...new Set(cells.map((c) => c.key))];
    const cached = new Map<string, { windDir: number; windSpd: number }>();

    const cacheValues = await Promise.all(
      uniqueKeys.map((k) => client.get(k).catch(() => null)),
    );
    for (let i = 0; i < uniqueKeys.length; i++) {
      if (cacheValues[i]) {
        try { cached.set(uniqueKeys[i]!, JSON.parse(cacheValues[i]!)); } catch { /* skip */ }
      }
    }

    const missingCells = cells.filter((c) => !cached.has(c.key));
    const uniqueMissing = [...new Map(missingCells.map((c) => [c.key, c])).values()];

    if (uniqueMissing.length > 0) {
      try {
        const lats = uniqueMissing.map((c) => c.rLat).join(',');
        const lons = uniqueMissing.map((c) => c.rLon).join(',');
        const spdVar = `wind_speed_${level}hPa`;
        const dirVar = `wind_direction_${level}hPa`;

        const url = `${OPEN_METEO_URL}?latitude=${lats}&longitude=${lons}` +
          `&hourly=${spdVar},${dirVar}&forecast_hours=24&timeformat=unixtime&wind_speed_unit=kn`;

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeout);

        if (response.ok) {
          const data = await response.json();
          const results: Record<string, unknown>[] = uniqueMissing.length === 1
            ? [data as Record<string, unknown>]
            : (data as Record<string, unknown>[]);

          for (let i = 0; i < uniqueMissing.length; i++) {
            const cell = uniqueMissing[i]!;
            const result = results[i];
            if (!result) continue;

            const hourly = result.hourly as Record<string, unknown> | undefined;
            if (!hourly) continue;

            const times = hourly.time as number[] | undefined;
            const speeds = hourly[spdVar] as number[] | undefined;
            const dirs = hourly[dirVar] as number[] | undefined;
            if (!times || !speeds || !dirs) continue;

            let bestIdx = 0;
            let bestTimeDiff = Math.abs(times[0]! - targetEpochSec);
            for (let j = 1; j < times.length; j++) {
              const diff = Math.abs(times[j]! - targetEpochSec);
              if (diff < bestTimeDiff) { bestIdx = j; bestTimeDiff = diff; }
            }

            const wind = { windDir: dirs[bestIdx] ?? 0, windSpd: speeds[bestIdx] ?? 0 };
            cached.set(cell.key, wind);
            await client.setEx(cell.key, WINDS_ALOFT_CACHE_TTL, JSON.stringify(wind)).catch(() => {});
          }
        }
      } catch (err) {
        this.logger.warn(`Open-Meteo winds fetch failed: ${err}`);
      }
    }

    return points.map((p, i) => {
      const wind = cached.get(cells[i]!.key) ?? { windDir: 0, windSpd: 0 };
      return { lat: p.lat, lon: p.lon, ...wind };
    });
  }

  private computePerformanceAdjustments(
    waypoints: { lat: number; lon: number }[],
    winds: { windDir: number; windSpd: number }[],
    tasKts: number,
    totalDistanceNm: number,
    fuelBurnLph: number | null,
  ): PerformanceAdjustments {
    let totalWindTime = 0;
    let weightedHeadwind = 0;
    let totalDist = 0;

    for (let i = 0; i < waypoints.length - 1; i++) {
      const a = waypoints[i]!;
      const b = waypoints[i + 1]!;
      const legDist = geoHaversineNm(a.lat, a.lon, b.lat, b.lon);
      if (legDist < 0.1) continue;

      const tc = initialBearing(a.lat, a.lon, b.lat, b.lon);
      const midIdx = Math.min(i, winds.length - 1);
      const w = winds[midIdx]!;

      const { groundSpeed } = windTriangle(tasKts, tc, w.windDir, w.windSpd);
      const headwindComponent = w.windSpd * Math.cos(((w.windDir - tc) * Math.PI) / 180);

      totalWindTime += legDist / groundSpeed;
      weightedHeadwind += headwindComponent * legDist;
      totalDist += legDist;
    }

    const avgHeadwind = totalDist > 0 ? weightedHeadwind / totalDist : 0;
    const distForCalc = totalDistanceNm > 0 ? totalDistanceNm : totalDist;
    const noWindTimeMin = (distForCalc / tasKts) * 60;
    const windTimeMin = totalDist > 0 ? totalWindTime * 60 * (distForCalc / totalDist) : noWindTimeMin;
    const timeDeltaMin = windTimeMin - noWindTimeMin;
    const additionalFuelKg = fuelBurnLph != null
      ? (timeDeltaMin / 60) * fuelBurnLph * AVGAS_DENSITY_KG_L
      : 0;

    return {
      averageHeadwindKts: Math.round(avgHeadwind * 10) / 10,
      estimatedTimeIncreaseMinutes: Math.round(timeDeltaMin * 10) / 10,
      additionalFuelRequiredKg: Math.round(additionalFuelKg * 10) / 10,
    };
  }

  private normalizeHazardType(hazard: string | null | undefined): SigmetHazardType {
    if (!hazard) return 'OTHER';
    const h = hazard.toUpperCase();
    if (h.includes('TS') || h.includes('CONVECT')) return 'TS';
    if (h.includes('TURB')) return 'TURB';
    if (h.includes('ICE') || h.includes('ICING')) return 'ICE';
    if (h.includes('IFR') || h.includes('CEIL') || h.includes('VIS')) return 'IFR';
    if (h.includes('MTN') || h.includes('OBSC')) return 'MTN_OBSC';
    return 'OTHER';
  }

  // --------------- Nearby station fallback ---------------

  private async fetchNearbyMetar(icao: string): Promise<ParsedMetar | null> {
    try {
      const airport = await this.prisma.airport.findUnique({
        where: { icao },
        select: { latitude: true, longitude: true },
      });
      if (!airport) return null;

      const { latitude: lat, longitude: lon } = airport;
      const delta = 1.0; // ~60 nm search radius
      const bbox = `${lat - delta},${lon - delta},${lat + delta},${lon + delta}`;
      const url = `${METAR_API_URL}?bbox=${bbox}&format=json`;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);

      if (!response.ok) return null;

      const data = (await response.json()) as (AddsMetarResponse & { lat: number; lon: number })[];
      if (data.length === 0) return null;

      // Find nearest station by haversine
      let nearest = data[0]!;
      let nearestDist = this.haversineNm(lat, lon, nearest.lat, nearest.lon);
      for (let i = 1; i < data.length; i++) {
        const d = this.haversineNm(lat, lon, data[i]!.lat, data[i]!.lon);
        if (d < nearestDist) {
          nearest = data[i]!;
          nearestDist = d;
        }
      }

      const parsed = this.parseAddsResponse(nearest);
      return {
        ...parsed,
        icaoId: icao,
        source: 'nearby',
        nearbyFrom: nearest.icaoId,
        nearbyDistanceNm: Math.round(nearestDist),
      };
    } catch (err) {
      this.logger.warn(`Nearby METAR fallback failed for ${icao}: ${err}`);
      return null;
    }
  }

  private haversineNm(lat1: number, lon1: number, lat2: number, lon2: number): number {
    return geoHaversineNm(lat1, lon1, lat2, lon2);
  }

  // --------------- NOAA text fallback ---------------

  private async fetchNoaaTextMetar(icao: string): Promise<ParsedMetar | null> {
    try {
      const url = `${NOAA_TEXT_URL}/${icao}.TXT`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      const response = await fetch(url, {
        signal: controller.signal,
        redirect: 'follow',
      });
      clearTimeout(timeout);

      if (!response.ok) return null;

      const text = await response.text();
      return this.parseNoaaTextMetar(icao, text);
    } catch {
      return null;
    }
  }

  private parseNoaaTextMetar(icao: string, text: string): ParsedMetar | null {
    const lines = text.trim().split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length < 2) return null;

    const dateLine = lines[0]!;
    const rawMetar = lines.slice(1).join(' ').replace(/\s+/g, ' ').trim();

    // Parse observation time from first line (format: YYYY/MM/DD HH:MM)
    const dateMatch = dateLine.match(/^(\d{4})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2})$/);
    if (!dateMatch) return null;
    const obsTime = new Date(`${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}T${dateMatch[4]}:${dateMatch[5]}:00Z`);

    // Reject impossibly old observations (older than 24 hours)
    if (Date.now() - obsTime.getTime() > 24 * 3_600_000) return null;

    return this.parseRawMetar(icao, rawMetar, obsTime.toISOString());
  }

  private parseRawMetar(icao: string, raw: string, observationTime: string): ParsedMetar {
    // Split body from remarks
    const rmkIdx = raw.indexOf(' RMK ');
    const body = rmkIdx >= 0 ? raw.slice(0, rmkIdx) : raw;
    const rmkSection = rmkIdx >= 0 ? raw.slice(rmkIdx + 5) : '';
    const tokens = body.split(/\s+/);

    // Wind: dddssKT or dddssGggKT or VRBssKT
    let windDirection: number | string | null = null;
    let windSpeed: number | null = null;
    let windGust: number | null = null;
    const windToken = tokens.find((t) => /^\d{3}\d{2,3}(G\d{2,3})?KT$/.test(t) || /^VRB\d{2,3}(G\d{2,3})?KT$/.test(t));
    if (windToken) {
      const wm = windToken.match(/^(VRB|\d{3})(\d{2,3})(G(\d{2,3}))?KT$/);
      if (wm) {
        windDirection = wm[1] === 'VRB' ? 'VRB' : parseInt(wm[1]!, 10);
        windSpeed = parseInt(wm[2]!, 10);
        windGust = wm[4] ? parseInt(wm[4], 10) : null;
      }
    }
    if (tokens.includes('00000KT')) {
      windDirection = 0;
      windSpeed = 0;
    }

    // Variable wind direction: 280V350
    let variableWindDir: { from: number; to: number } | undefined;
    const varWindToken = tokens.find((t) => /^\d{3}V\d{3}$/.test(t));
    if (varWindToken) {
      const [from, to] = varWindToken.split('V');
      variableWindDir = { from: parseInt(from!, 10), to: parseInt(to!, 10) };
    }

    // Visibility: meters (4 digits) or statute miles
    let visibility: string | null = null;
    const visMeters = tokens.find((t) => /^\d{4}$/.test(t) && !t.match(/^\d{4}Z$/) && parseInt(t, 10) >= 100);
    if (visMeters) {
      visibility = visMeters;
    } else {
      const visSm = tokens.find((t) => /^\d+SM$/.test(t) || /^\d+\/\d+SM$/.test(t));
      if (visSm) visibility = visSm.replace('SM', '');
    }

    // Present weather phenomena
    const presentWeather: string[] = [];
    for (const t of tokens) {
      if (PRESENT_WEATHER_RE.test(t)) {
        presentWeather.push(t);
      }
    }

    // Clouds
    const clouds: MetarCloud[] = [];
    for (const t of tokens) {
      const cm = t.match(/^(FEW|SCT|BKN|OVC)(\d{3})(CB|TCU)?$/);
      if (cm) {
        clouds.push({ cover: cm[1]!, base: parseInt(cm[2]!, 10) * 100 });
      }
    }

    // Temperature/Dewpoint: TT/DD (M prefix = negative)
    let temperature: number | null = null;
    let dewpoint: number | null = null;
    const tempToken = tokens.find((t) => /^M?\d{2}\/M?\d{2}$/.test(t));
    if (tempToken) {
      const [tStr, dStr] = tempToken.split('/');
      temperature = tStr!.startsWith('M') ? -parseInt(tStr!.slice(1), 10) : parseInt(tStr!, 10);
      dewpoint = dStr!.startsWith('M') ? -parseInt(dStr!.slice(1), 10) : parseInt(dStr!, 10);
    }

    // Altimeter: Qnnnn (hPa) or Annnn (inHg)
    let altimeter: number | null = null;
    const qnh = tokens.find((t) => /^Q\d{4}$/.test(t));
    if (qnh) {
      altimeter = parseInt(qnh.slice(1), 10);
    } else {
      const aToken = tokens.find((t) => /^A\d{4}$/.test(t));
      if (aToken) {
        altimeter = Math.round(parseInt(aToken.slice(1), 10) * 0.338639);
      }
    }

    // Remarks: windshear and peak wind
    const remarks = this.parseRemarks(rmkSection);

    // Ceiling & flight category
    const ceilingLayer = clouds
      .filter((c) => c.cover === 'BKN' || c.cover === 'OVC')
      .sort((a, b) => a.base - b.base)[0];
    const ceiling = ceilingLayer?.base ?? null;

    const flightCategory = this.computeFlightCategory(visibility, ceiling);

    return {
      icaoId: icao,
      raw,
      observationTime,
      windDirection,
      windSpeed,
      windGust,
      visibility,
      altimeter,
      temperature,
      dewpoint,
      clouds,
      flightCategory,
      ceiling,
      source: 'noaa-text',
      presentWeather: presentWeather.length > 0 ? presentWeather : undefined,
      variableWindDir,
      remarks: remarks ?? undefined,
    };
  }

  private parseRemarks(rmk: string): { windshear?: string; peakWind?: string } | undefined {
    if (!rmk) return undefined;

    let windshear: string | undefined;
    let peakWind: string | undefined;

    const wsMatch = rmk.match(/WS\s+(R\w+|ALL\s+RWY)/);
    if (wsMatch) windshear = wsMatch[0].trim();

    const pkMatch = rmk.match(/PK\s+WND\s+\d{3}\d{2,3}\/\d{2,4}/);
    if (pkMatch) peakWind = pkMatch[0].trim();

    if (!windshear && !peakWind) return undefined;
    return { windshear, peakWind };
  }

  private computeFlightCategory(visibility: string | null, ceiling: number | null): string {
    let visSm = 99;
    if (visibility != null) {
      const visNum = parseInt(visibility, 10);
      if (!isNaN(visNum)) {
        // If >= 100, it's meters; convert to SM
        visSm = visNum >= 100 ? visNum / 1609.34 : visNum;
      }
    }
    const ceilFt = ceiling ?? 99999;

    if (visSm < 1 || ceilFt < 500) return 'LIFR';
    if (visSm < 3 || ceilFt < 1000) return 'IFR';
    if (visSm <= 5 || ceilFt <= 3000) return 'MVFR';
    return 'VFR';
  }

  // --------------- ADDS parsers ---------------

  private parseAddsTafResponse(entry: AddsTafResponse): ParsedTaf {
    const periods: TafForecastPeriod[] = (entry.fcsts ?? []).map((f) => {
      const ceilingLayer = f.clouds
        ?.filter((c) => (c.cover === 'BKN' || c.cover === 'OVC') && c.base != null)
        .sort((a, b) => (a.base ?? 99999) - (b.base ?? 99999))[0];

      let flightCategory: string | null = null;
      const vis = typeof f.visib === 'number' ? f.visib : parseFloat(String(f.visib));
      const ceil = ceilingLayer?.base ?? null;
      if (!isNaN(vis) || ceil != null) {
        const visSm = isNaN(vis) ? 99 : vis;
        const ceilFt = ceil ?? 99999;
        if (visSm < 1 || ceilFt < 500) flightCategory = 'LIFR';
        else if (visSm < 3 || ceilFt < 1000) flightCategory = 'IFR';
        else if (visSm <= 5 || ceilFt <= 3000) flightCategory = 'MVFR';
        else flightCategory = 'VFR';
      }

      return {
        timeFrom: f.timeFrom,
        timeTo: f.timeTo,
        timeBec: f.timeBec ?? null,
        fcstChange: f.fcstChange,
        probability: f.probability,
        windDirection: f.wdir ?? null,
        windSpeed: f.wspd ?? null,
        windGust: f.wgst ?? null,
        visibility: f.visib ?? null,
        wxString: f.wxString,
        clouds: f.clouds ?? [],
        flightCategory,
      };
    });

    return {
      icaoId: entry.icaoId,
      raw: entry.rawTAF,
      issueTime: entry.issueTime,
      validFrom: entry.validTimeFrom,
      validTo: entry.validTimeTo,
      periods,
    };
  }

  private parseAddsResponse(entry: AddsMetarResponse): ParsedMetar {
    const ceilingLayer = entry.clouds
      ?.filter((c) => c.cover === 'BKN' || c.cover === 'OVC')
      .sort((a, b) => a.base - b.base)[0];

    // Extract V2 fields from raw observation text
    const rawTokens = (entry.rawOb ?? '').split(/\s+/);
    const presentWeather: string[] = [];
    let variableWindDir: { from: number; to: number } | undefined;

    for (const t of rawTokens) {
      if (PRESENT_WEATHER_RE.test(t)) presentWeather.push(t);
    }
    const varWindToken = rawTokens.find((t) => /^\d{3}V\d{3}$/.test(t));
    if (varWindToken) {
      const [from, to] = varWindToken.split('V');
      variableWindDir = { from: parseInt(from!, 10), to: parseInt(to!, 10) };
    }

    const rmkIdx = (entry.rawOb ?? '').indexOf(' RMK ');
    const remarks = rmkIdx >= 0 ? this.parseRemarks(entry.rawOb.slice(rmkIdx + 5)) : undefined;

    return {
      icaoId: entry.icaoId,
      raw: entry.rawOb,
      observationTime: entry.reportTime,
      windDirection: entry.wdir ?? null,
      windSpeed: entry.wspd ?? null,
      windGust: entry.wgst ?? null,
      visibility: entry.visib ?? null,
      altimeter: entry.altim ?? null,
      temperature: entry.temp ?? null,
      dewpoint: entry.dewp ?? null,
      clouds: entry.clouds ?? [],
      flightCategory: entry.fltCat ?? null,
      ceiling: ceilingLayer?.base ?? null,
      source: 'adds',
      presentWeather: presentWeather.length > 0 ? presentWeather : undefined,
      variableWindDir,
      remarks,
    };
  }

  private owmQueue: (() => void)[] = [];
  private owmActive = 0;
  private static readonly OWM_MAX_CONCURRENT = 2;

  private async owmThrottled<T>(fn: () => Promise<T>): Promise<T> {
    if (this.owmActive >= WeatherService.OWM_MAX_CONCURRENT) {
      await new Promise<void>((resolve) => this.owmQueue.push(resolve));
    }
    this.owmActive++;
    try {
      return await fn();
    } finally {
      this.owmActive--;
      this.owmQueue.shift()?.();
    }
  }

  async getPrecipitationTile(z: number, x: number, y: number): Promise<Buffer | null> {
    const apiKey = this.config.get<string>('OWM_API_KEY');
    if (!apiKey) return null;

    const cacheKey = `owm:precip:${z}:${x}:${y}`;
    const client = this.redis.getClient();

    const cached = await client.get(cacheKey);
    if (cached) return Buffer.from(cached, 'base64');

    return this.owmThrottled(async () => {
      const rechecked = await client.get(cacheKey);
      if (rechecked) return Buffer.from(rechecked, 'base64');

      const resp = await fetch(
        `https://tile.openweathermap.org/map/precipitation_new/${z}/${x}/${y}.png?appid=${apiKey}`,
      );
      if (!resp.ok) return null;

      const raw = Buffer.from(await resp.arrayBuffer());
      const buffer = await this.recolorPrecipTile(raw);
      await client.set(cacheKey, buffer.toString('base64'), { EX: 600 });
      return buffer;
    });
  }

  private async recolorPrecipTile(png: Buffer): Promise<Buffer> {
    const sharp = (await import('sharp')).default;
    const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3]!;
      if (a < 8) { data[i + 3] = 0; continue; }

      const r = data[i]!; const g = data[i + 1]!; const b = data[i + 2]!;
      const intensity = Math.min(1, (r * 0.15 + g * 0.15 + b * 0.7) * (a / 255) / 100);
      const [nr, ng, nb, na] = WeatherService.precipColor(intensity);
      data[i] = nr; data[i + 1] = ng; data[i + 2] = nb; data[i + 3] = na;
    }

    return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
  }

  private static precipColor(t: number): [number, number, number, number] {
    if (t < 0.01) return [0, 0, 0, 0];
    const a = Math.round(80 + t * 175);
    if (t < 0.15) return [120, 200, 255, a];   // light blue
    if (t < 0.30) return [30, 160, 255, a];    // blue
    if (t < 0.45) return [0, 210, 80, a];      // green
    if (t < 0.60) return [255, 240, 0, a];     // yellow
    if (t < 0.75) return [255, 160, 0, a];     // orange
    if (t < 0.90) return [255, 40, 0, a];      // red
    return [180, 0, 200, a];                    // magenta
  }
}
