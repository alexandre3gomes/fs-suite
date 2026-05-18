import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

const METAR_API_URL = 'https://aviationweather.gov/api/data/metar';
const TAF_API_URL = 'https://aviationweather.gov/api/data/taf';
const NOAA_TEXT_URL = 'https://tgftp.nws.noaa.gov/data/observations/metar/stations';
const CACHE_TTL_SECONDS = 600; // 10 minutes
const NOAA_STALE_THRESHOLD_MS = 3_600_000; // 1 hour
const REQUEST_TIMEOUT_MS = 8000;

export interface MetarCloud {
  cover: string; // FEW, SCT, BKN, OVC
  base: number; // feet AGL
}

export interface ParsedMetar {
  icaoId: string;
  raw: string;
  observationTime: string;
  windDirection: number | string | null; // degrees or "VRB"
  windSpeed: number | null; // knots
  windGust: number | null; // knots
  visibility: string | null; // statute miles or meters
  altimeter: number | null; // hPa (QNH)
  temperature: number | null; // celsius
  dewpoint: number | null; // celsius
  clouds: MetarCloud[];
  flightCategory: string | null; // VFR, MVFR, IFR, LIFR
  ceiling: number | null; // feet AGL (lowest BKN/OVC)
  source: 'adds' | 'noaa-text' | 'nearby';
  nearbyFrom?: string; // ICAO of the station providing this METAR
  nearbyDistanceNm?: number;
}

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

export interface TafForecastPeriod {
  timeFrom: number;
  timeTo: number;
  timeBec: number | null;
  fcstChange: string | null;
  probability: number | null;
  windDirection: number | null;
  windSpeed: number | null;
  windGust: number | null;
  visibility: number | string | null;
  wxString: string | null;
  clouds: { cover: string; base: number | null }[];
  flightCategory: string | null;
}

export interface ParsedTaf {
  icaoId: string;
  raw: string;
  issueTime: string;
  validFrom: number;
  validTo: number;
  periods: TafForecastPeriod[];
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
  ) {}

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
          await client.setEx(`metar:${parsed.icaoId}`, CACHE_TTL_SECONDS, JSON.stringify(parsed)).catch(() => {});
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
          await client.setEx(`metar:${parsed.icaoId}`, CACHE_TTL_SECONDS, JSON.stringify(parsed)).catch(() => {});
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
          await client.setEx(`metar:${parsed.icaoId}`, CACHE_TTL_SECONDS, JSON.stringify(parsed)).catch(() => {});
          results.push(parsed);
        }
      }
    }

    return normalized
      .map((icao) => results.find((r) => r.icaoId === icao))
      .filter((r): r is ParsedMetar => r != null);
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
          .setEx(`taf:${parsed.icaoId}`, CACHE_TTL_SECONDS, JSON.stringify(parsed))
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
    const tokens = raw.split(/\s+/);

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
    // Calm wind
    if (tokens.includes('00000KT')) {
      windDirection = 0;
      windSpeed = 0;
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

    // Clouds
    const clouds: MetarCloud[] = [];
    for (const t of tokens) {
      const cm = t.match(/^(FEW|SCT|BKN|OVC)(\d{3})$/);
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
    };
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
    };
  }
}
