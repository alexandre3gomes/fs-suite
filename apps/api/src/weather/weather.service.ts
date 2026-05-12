import { Injectable, Logger } from '@nestjs/common';

import { RedisService } from '../redis/redis.service';

const METAR_API_URL = 'https://aviationweather.gov/api/data/metar';
const TAF_API_URL = 'https://aviationweather.gov/api/data/taf';
const CACHE_TTL_SECONDS = 600; // 10 minutes
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
  visibility: string | null; // statute miles
  altimeter: number | null; // hPa (QNH)
  temperature: number | null; // celsius
  dewpoint: number | null; // celsius
  clouds: MetarCloud[];
  flightCategory: string | null; // VFR, MVFR, IFR, LIFR
  ceiling: number | null; // feet AGL (lowest BKN/OVC)
}

interface AvwxMetarResponse {
  icaoId: string;
  rawOb: string;
  reportTime: string;
  wdir: number | string;
  wspd: number;
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

interface AvwxTafResponse {
  icaoId: string;
  rawTAF: string;
  issueTime: string;
  validTimeFrom: number;
  validTimeTo: number;
  fcsts: {
    timeFrom: number;
    timeTo: number;
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

  constructor(private readonly redis: RedisService) {}

  async getMetars(icaos: string[]): Promise<ParsedMetar[]> {
    if (icaos.length === 0) return [];

    const normalized = icaos.map((c) => c.toUpperCase().trim()).filter((c) => /^[A-Z]{4}$/.test(c));
    if (normalized.length === 0) return [];

    // Check cache for each ICAO
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

    // Fetch missing from AviationWeather.gov
    try {
      const url = `${METAR_API_URL}?ids=${missing.join(',')}&format=json`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);

      if (!response.ok) {
        this.logger.warn(`AviationWeather API returned ${response.status}`);
        return results;
      }

      const data = (await response.json()) as AvwxMetarResponse[];

      for (const entry of data) {
        const parsed = this.parseAvwxResponse(entry);

        // Cache individual METAR
        await client
          .setEx(`metar:${parsed.icaoId}`, CACHE_TTL_SECONDS, JSON.stringify(parsed))
          .catch(() => {});

        results.push(parsed);
      }
    } catch (err) {
      this.logger.warn(`Failed to fetch METAR for ${missing.join(',')}: ${err}`);
    }

    // Return in the same order as requested
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
        this.logger.warn(`AviationWeather TAF API returned ${response.status}`);
        return results;
      }

      const data = (await response.json()) as AvwxTafResponse[];

      for (const entry of data) {
        const parsed = this.parseAvwxTafResponse(entry);
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

  private parseAvwxTafResponse(entry: AvwxTafResponse): ParsedTaf {
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

  private parseAvwxResponse(entry: AvwxMetarResponse): ParsedMetar {
    // Find ceiling: lowest BKN or OVC layer
    const ceilingLayer = entry.clouds
      ?.filter((c) => c.cover === 'BKN' || c.cover === 'OVC')
      .sort((a, b) => a.base - b.base)[0];

    return {
      icaoId: entry.icaoId,
      raw: entry.rawOb,
      observationTime: entry.reportTime,
      windDirection: entry.wdir ?? null,
      windSpeed: entry.wspd ?? null,
      visibility: entry.visib ?? null,
      altimeter: entry.altim ?? null,
      temperature: entry.temp ?? null,
      dewpoint: entry.dewp ?? null,
      clouds: entry.clouds ?? [],
      flightCategory: entry.fltCat ?? null,
      ceiling: ceilingLayer?.base ?? null,
    };
  }
}
