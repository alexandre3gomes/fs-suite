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

import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

import { decodeMetarToPtBr } from './metar-decoder';
import { assessSafety, type SafetyAssessment, type SafetyCheckParams } from './safety-checker';

export type { SafetyAssessment } from './safety-checker';

const METAR_API_URL = 'https://aviationweather.gov/api/data/metar';
const TAF_API_URL = 'https://aviationweather.gov/api/data/taf';
const NOAA_TEXT_URL = 'https://tgftp.nws.noaa.gov/data/observations/metar/stations';
const NOAA_STALE_THRESHOLD_MS = 3_600_000; // 1 hour
const REQUEST_TIMEOUT_MS = 8000;
const ISIGMET_API_URL = 'https://aviationweather.gov/api/data/isigmet?format=geojson';
const AIRSIGMET_API_URL = 'https://aviationweather.gov/api/data/airsigmet?format=geojson';
const SIGMET_CACHE_KEY = 'weather:sigmets';

// Differentiated cache TTLs
const METAR_CACHE_TTL = 600; // 10 minutes
const TAF_CACHE_TTL = 3600; // 1 hour — TAFs change infrequently
const SIGMET_CACHE_TTL = 600; // 10 minutes — safety-critical
const AVWX_CACHE_TTL = 600; // 10 minutes
const ROUTE_IMPACT_CACHE_TTL = 600; // 10 minutes

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

  async getFlightCategories(icaos: string[]): Promise<{ icao: string; flightCategory: string | null }[]> {
    if (icaos.length === 0) return [];

    const normalized = icaos.map((c) => c.toUpperCase().trim()).filter((c) => /^[A-Z]{4}$/.test(c));
    if (normalized.length === 0) return [];

    const client = this.redis.getClient();
    const results = new Map<string, string | null>();
    const missing: string[] = [];

    for (const icao of normalized) {
      const cached = await client.get(`metar:${icao}`).catch(() => null);
      if (cached) {
        const parsed = JSON.parse(cached) as ParsedMetar;
        const obsAge = Date.now() - new Date(parsed.observationTime).getTime();
        if (obsAge <= NOAA_STALE_THRESHOLD_MS) {
          results.set(icao, parsed.flightCategory);
        } else {
          missing.push(icao);
        }
      } else {
        missing.push(icao);
      }
    }

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
            results.set(parsed.icaoId, parsed.flightCategory);
          }
        }
      } catch (err) {
        this.logger.warn(`ADDS flight-category fetch failed: ${err}`);
      }
    }

    return normalized.map((icao) => ({
      icao,
      flightCategory: results.get(icao) ?? null,
    }));
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
        const parsed = JSON.parse(cached) as ParsedMetar;
        const obsAge = Date.now() - new Date(parsed.observationTime).getTime();
        if (obsAge > NOAA_STALE_THRESHOLD_MS) {
          missing.push(icao);
        } else {
          results.push(parsed);
        }
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
              validFrom: p.validTimeFrom ? new Date(p.validTimeFrom * 1000).toISOString() : '',
              validTo: p.validTimeTo ? new Date(p.validTimeTo * 1000).toISOString() : '',
              firId: p.firId ?? p.icaoId ?? null,
              sigmetType: 'SIGMET',
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
              validFrom: p.validTimeFrom ? new Date(p.validTimeFrom * 1000).toISOString() : '',
              validTo: p.validTimeTo ? new Date(p.validTimeTo * 1000).toISOString() : '',
              firId: null,
              sigmetType: p.airsigmetType === 'AIRMET' ? 'AIRMET' : 'SIGMET',
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
    groundSpeed: number | null;
    enduranceMinutes: number | null;
    fuelReserveMinutes: number | null;
  }): Promise<SafetyAssessment> {
    const icaos = [plan.originIcao, plan.destinationIcao, plan.alternateIcao].filter(
      (v): v is string => v != null,
    );

    const [metarList, tafList] = await Promise.all([
      this.getMetars(icaos),
      this.getTafs(icaos),
    ]);

    const metars: Record<string, ParsedMetar> = {};
    for (const m of metarList) metars[m.icaoId] = m;

    const tafs: Record<string, ParsedTaf> = {};
    for (const t of tafList) tafs[t.icaoId] = t;

    const nowSec = Math.floor(Date.now() / 1000);
    const totalDistanceNm = plan.todDistanceNm ?? 0;
    const cruiseSpeedKts = plan.groundSpeed ?? null;
    const enduranceMin = plan.enduranceMinutes ?? 0;
    const tripTimeSec =
      cruiseSpeedKts && totalDistanceNm > 0
        ? Math.round((totalDistanceNm / cruiseSpeedKts) * 3600)
        : null;

    const reserveMin = plan.fuelReserveMinutes ?? 30;
    const fuelOnBoard = plan.fuelCurrentTotal ?? 0;
    const fuelRequired = plan.fuelRequiredTotal ?? 0;

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
      departureEpochSec: nowSec,
      arrivalEpochSec: tripTimeSec ? nowSec + tripTimeSec : null,
      metars,
      tafs,
    };

    return assessSafety(params);
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
    const R = 3440.065; // Earth radius in nm
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
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

    // Reject stale observations (older than 3 hours)
    if (Date.now() - obsTime.getTime() > 3 * NOAA_STALE_THRESHOLD_MS) return null;

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
}
