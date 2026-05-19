import type { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as https from 'https';
import * as path from 'path';

import { computeDataCompleteness } from '@fs-suite/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EnrichmentPatch {
  emptyWeightKg?: number;
  mtowKg?: number;
  fuelBurnLph?: number;
  stations?: { stationId: string; labelKey: string; defaultKg: number; maxKg: number; arm: number }[];
}

interface OpenApData {
  oew: number | null;
  mtow: number | null;
  numEngines: number;
  defaultEngine: string | null;
}

interface EngineData {
  ffCo: number; // fuel flow at climb-out, kg/s per engine
}

interface JsbSimStation {
  stationId: string;
  labelKey: string;
  defaultKg: number;
  maxKg: number;
  arm: number;
}

interface JsbSimData {
  emptyWeightKg: number | null;
  stations: JsbSimStation[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LB_TO_KG = 0.453592;
const IN_TO_M = 0.0254;
const JET_A1_DENSITY = 0.8; // kg/L
const CRUISE_TO_CLIMBOUT_RATIO = 0.33;

const CACHE_DIR_NAME = '.enrich-cache';

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function fetchText(url: string, headers?: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    const request = (reqUrl: string): void => {
      const parsed = new URL(reqUrl);
      const options = {
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
          ...headers,
        },
      };
      https
        .get(options, (res) => {
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            request(res.headers.location);
            return;
          }
          if (res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode} for ${reqUrl}`));
            return;
          }
          let data = '';
          res.on('data', (chunk: Buffer) => (data += chunk.toString()));
          res.on('end', () => resolve(data));
        })
        .on('error', reject);
    };
    request(url);
  });
}

function fetchBuffer(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const request = (reqUrl: string): void => {
      const parsed = new URL(reqUrl);
      const options = {
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        },
      };
      https
        .get(options, (res) => {
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            request(res.headers.location);
            return;
          }
          if (res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode} for ${reqUrl}`));
            return;
          }
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => resolve(Buffer.concat(chunks)));
        })
        .on('error', reject);
    };
    request(url);
  });
}

function ensureCacheDir(): string {
  const dir = path.join(__dirname, 'data', CACHE_DIR_NAME);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ---------------------------------------------------------------------------
// Source 1: OpenAP — airline aircraft YAML + engine fuel flow CSV
// ---------------------------------------------------------------------------

const OPENAP_ICAO_TYPES = [
  'A19N', 'A20N', 'A21N', 'A318', 'A319', 'A320', 'A321',
  'A332', 'A333', 'A343', 'A359', 'A388',
  'B37M', 'B38M', 'B39M', 'B3XM',
  'B734', 'B737', 'B738', 'B739', 'B744', 'B748',
  'B752', 'B763', 'B772', 'B773', 'B77W', 'B788', 'B789',
  'C550', 'CRJ9', 'E145', 'E170', 'E190', 'E195', 'E75L', 'GLF6',
];

async function fetchOpenApEngines(cacheDir: string): Promise<Map<string, EngineData>> {
  const cacheFile = path.join(cacheDir, 'openap_engines.csv');
  let csv: string;

  if (fs.existsSync(cacheFile)) {
    csv = fs.readFileSync(cacheFile, 'utf-8');
  } else {
    csv = await fetchText('https://raw.githubusercontent.com/junzis/openap/master/openap/data/engine/engines.csv');
    fs.writeFileSync(cacheFile, csv);
  }

  const lines = csv.split('\n').filter((l) => l.trim());
  const headers = lines[0]!.split(',');
  const nameIdx = headers.indexOf('name');
  const ffCoIdx = headers.indexOf('ff_co');

  const result = new Map<string, EngineData>();

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i]!.split(',');
    const name = cols[nameIdx]?.trim();
    if (!name) continue;

    const ffCo = parseFloat(cols[ffCoIdx] ?? '');
    if (isNaN(ffCo) || ffCo <= 0) continue;

    result.set(name, { ffCo });
  }

  return result;
}

function computeFuelBurnLph(engine: EngineData, numEngines: number): number {
  // Cruise fuel flow ≈ 33% of climb-out fuel flow per engine
  // Validated against known fuel burns: A320 ~3029, B744 ~11000, E190 ~2000
  const fuelFlowKgS = engine.ffCo * CRUISE_TO_CLIMBOUT_RATIO;
  return Math.round((fuelFlowKgS * numEngines * 3600) / JET_A1_DENSITY);
}

async function fetchOpenApData(): Promise<Map<string, OpenApData & { fuelBurnLph: number | null }>> {
  const yaml = require('yaml');
  const cacheDir = ensureCacheDir();
  const result = new Map<string, OpenApData & { fuelBurnLph: number | null }>();

  const engines = await fetchOpenApEngines(cacheDir);
  console.log(`  OpenAP engines: ${engines.size} entries loaded`);

  for (const icao of OPENAP_ICAO_TYPES) {
    const cacheFile = path.join(cacheDir, `openap_${icao.toLowerCase()}.yml`);
    let raw: string;

    try {
      if (fs.existsSync(cacheFile)) {
        raw = fs.readFileSync(cacheFile, 'utf-8');
      } else {
        const url = `https://raw.githubusercontent.com/junzis/openap/master/openap/data/aircraft/${icao.toLowerCase()}.yml`;
        raw = await fetchText(url);
        fs.writeFileSync(cacheFile, raw);
      }

      const parsed = yaml.parse(raw);

      const oew: number | null = parsed.oew ?? parsed.limits?.OEW ?? null;
      const mtow: number | null = parsed.mtow ?? parsed.limits?.MTOW ?? null;
      const numEngines: number = parsed.engine?.number ?? 2;
      const defaultEngine: string | null = parsed.engine?.default ?? null;

      let fuelBurnLph: number | null = null;

      if (defaultEngine) {
        // Try exact match first, then partial match
        let engineData = engines.get(defaultEngine);
        if (!engineData) {
          for (const [name, data] of engines) {
            if (name.startsWith(defaultEngine) || defaultEngine.startsWith(name)) {
              engineData = data;
              break;
            }
          }
        }
        if (engineData) {
          fuelBurnLph = computeFuelBurnLph(engineData, numEngines);
        }
      }

      result.set(icao, { oew, mtow, numEngines, defaultEngine, fuelBurnLph });
    } catch (err) {
      console.warn(`  OpenAP: failed for ${icao}: ${(err as Error).message}`);
    }
  }

  console.log(`OpenAP: loaded ${result.size}/${OPENAP_ICAO_TYPES.length} aircraft`);
  return result;
}

// ---------------------------------------------------------------------------
// Source 2: FAA Aircraft Characteristics Database (Excel)
// ---------------------------------------------------------------------------

const FAA_ACD_URL = 'https://www.faa.gov/airports/engineering/aircraft_char_database/aircraft_data';

async function fetchFaaAcdData(): Promise<Map<string, { mtowLb: number; oewLb: number | null }>> {
  const XLSX = require('xlsx');
  const cacheDir = ensureCacheDir();
  const cacheFile = path.join(cacheDir, 'faa_acd.xlsx');
  const result = new Map<string, { mtowLb: number; oewLb: number | null }>();

  try {
    if (!fs.existsSync(cacheFile)) {
      console.log('  FAA ACD: downloading Excel file...');
      const buffer = await fetchBuffer(FAA_ACD_URL);
      fs.writeFileSync(cacheFile, buffer);
    }

    const workbook = XLSX.readFile(cacheFile);
    const sheet = workbook.Sheets[workbook.SheetNames[0]!];
    const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet, { defval: '' });

    for (const row of rows) {
      const icao = String(row['ICAO_Code'] ?? '').trim();
      if (!icao || icao.length < 2 || icao.length > 4) continue;

      const mtowRaw = row['MTOW_lb'];
      const mtowLb = typeof mtowRaw === 'number' ? mtowRaw : parseFloat(String(mtowRaw));
      if (isNaN(mtowLb) || mtowLb <= 0) continue;

      const existing = result.get(icao);
      if (!existing || mtowLb > existing.mtowLb) {
        result.set(icao, { mtowLb, oewLb: null });
      }
    }
  } catch (err) {
    console.warn(`  FAA ACD: failed to load: ${(err as Error).message}`);
  }

  console.log(`FAA ACD: loaded ${result.size} unique ICAO types`);
  return result;
}

// ---------------------------------------------------------------------------
// Source 3: JSBSim — GA aircraft with mass_balance data (XML)
// ---------------------------------------------------------------------------

const JSBSIM_AIRCRAFT: { name: string; icao: string }[] = [
  { name: 'c172p', icao: 'C172' },
  { name: 'c172r', icao: 'C172' },
  { name: 'c172x', icao: 'C172' },
  { name: 'c182', icao: 'C182' },
  { name: 'c310', icao: 'C310' },
  { name: 'pa28', icao: 'PA28' },
  { name: 'J3Cub', icao: 'J3' },
  { name: 'L17', icao: 'L17' },
  { name: 'pc7', icao: 'PC7' },
  { name: 'DHC6', icao: 'DHC6' },
  { name: 'f16', icao: 'F16' },
  { name: 'T38', icao: 'T38' },
  { name: 'A320', icao: 'A320' },
  { name: 'MD11', icao: 'MD11' },
  { name: 'fokker100', icao: 'F100' },
  { name: 'fokker50', icao: 'F50' },
  { name: 'L410', icao: 'L410' },
  { name: 'global5000', icao: 'GL5T' },
];

async function fetchJsbSimData(): Promise<Map<string, JsbSimData>> {
  const { XMLParser } = require('fast-xml-parser');
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
  const cacheDir = ensureCacheDir();
  const result = new Map<string, JsbSimData>();

  for (const ac of JSBSIM_AIRCRAFT) {
    const cacheFile = path.join(cacheDir, `jsbsim_${ac.name}.xml`);
    let raw: string;

    try {
      if (fs.existsSync(cacheFile)) {
        raw = fs.readFileSync(cacheFile, 'utf-8');
      } else {
        const url = `https://raw.githubusercontent.com/JSBSim-Team/jsbsim/master/aircraft/${ac.name}/${ac.name}.xml`;
        raw = await fetchText(url);
        fs.writeFileSync(cacheFile, raw);
      }

      const xml = parser.parse(raw);
      const fdm = xml.fdm_config;
      if (!fdm) continue;

      const massBalance = fdm.mass_balance;
      if (!massBalance) continue;

      let emptyWeightKg: number | null = null;
      const stations: JsbSimStation[] = [];

      if (massBalance.emptywt) {
        const ewLb = typeof massBalance.emptywt === 'object'
          ? parseFloat(massBalance.emptywt['#text'] ?? massBalance.emptywt)
          : parseFloat(String(massBalance.emptywt));
        if (!isNaN(ewLb)) emptyWeightKg = Math.round(ewLb * LB_TO_KG);
      }

      const pointMasses = massBalance.pointmass;
      if (pointMasses) {
        const pms = Array.isArray(pointMasses) ? pointMasses : [pointMasses];
        let idx = 0;
        for (const pm of pms) {
          const name = pm['@_name'] ?? `Station ${idx + 1}`;
          const weightLb = pm.weight
            ? (typeof pm.weight === 'object' ? parseFloat(pm.weight['#text'] ?? '0') : parseFloat(String(pm.weight)))
            : 0;
          const maxWeightLb = pm.max_weight
            ? (typeof pm.max_weight === 'object' ? parseFloat(pm.max_weight['#text'] ?? '0') : parseFloat(String(pm.max_weight)))
            : weightLb * 2;

          let armM = 0;
          if (pm.location) {
            const xIn = pm.location.x
              ? (typeof pm.location.x === 'object' ? parseFloat(pm.location.x['#text'] ?? '0') : parseFloat(String(pm.location.x)))
              : 0;
            armM = Math.round(xIn * IN_TO_M * 1000) / 1000;
          }

          stations.push({
            stationId: `jsb_${ac.name}_${idx}`,
            labelKey: normalizeStationLabel(name),
            defaultKg: Math.round(weightLb * LB_TO_KG),
            maxKg: Math.round(Math.max(weightLb, maxWeightLb) * LB_TO_KG),
            arm: armM,
          });
          idx++;
        }
      }

      const existing = result.get(ac.icao);
      if (!existing || (stations.length > (existing.stations?.length ?? 0))) {
        result.set(ac.icao, { emptyWeightKg, stations });
      }
    } catch (err) {
      console.warn(`  JSBSim: failed for ${ac.name}: ${(err as Error).message}`);
    }
  }

  console.log(`JSBSim: loaded ${result.size} unique ICAO types`);
  return result;
}

function normalizeStationLabel(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes('copilot') || lower.includes('co-pilot') || lower.includes("co-pilot's")) return 'station.copilot';
  if (lower.includes('pilot') || lower.includes('crew') || lower.includes('cockpit')) return 'station.pilot';
  if (lower.includes('front') && lower.includes('pass')) return 'station.pax_front';
  if (lower.includes('rear') && lower.includes('pass')) return 'station.pax_rear';
  if (lower.includes('pass') || lower.includes('wife') || lower.includes('husband')) return 'station.pax';
  if (lower.includes('baggage') || lower.includes('cargo') || lower.includes('luggage')) return 'station.baggage';
  if (lower.includes('fuel')) return 'station.fuel';
  return `station.${lower.replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '')}`;
}

// ---------------------------------------------------------------------------
// Enrichment logic
// ---------------------------------------------------------------------------

export async function enrichAircraftProfiles(prisma: PrismaClient): Promise<void> {
  console.log('\n=== Aircraft Profile Enrichment ===\n');

  const profiles = await prisma.aircraftProfile.findMany({
    where: { isTemplate: true, userId: null },
    include: { stations: true },
  });

  const needsEnrichment = profiles.filter(
    (p) => p.dataCompleteness === 'partial' || p.dataCompleteness === 'skeleton',
  );

  if (needsEnrichment.length === 0) {
    console.log('No profiles need enrichment.');
    return;
  }

  console.log(`Found ${needsEnrichment.length} profiles needing enrichment\n`);

  const [openap, faaAcd, jsbsim] = await Promise.all([
    fetchOpenApData(),
    fetchFaaAcdData(),
    fetchJsbSimData(),
  ]);

  let enrichedCount = 0;
  let unchangedCount = 0;

  for (const profile of needsEnrichment) {
    const icao = profile.icaoType;
    if (!icao) {
      unchangedCount++;
      continue;
    }

    const patch: EnrichmentPatch = {};
    const sources: string[] = [];

    // --- OpenAP: OEW, MTOW, fuel burn ---
    const oapData = openap.get(icao);
    if (oapData) {
      if (!profile.emptyWeightKg && oapData.oew) {
        patch.emptyWeightKg = oapData.oew;
        sources.push('openap:oew');
      }
      if (!profile.mtowKg && oapData.mtow) {
        patch.mtowKg = oapData.mtow;
        sources.push('openap:mtow');
      }
      if (!profile.fuelBurnLph && oapData.fuelBurnLph) {
        patch.fuelBurnLph = oapData.fuelBurnLph;
        sources.push('openap:fuel');
      }
    }

    // --- FAA ACD: MTOW fallback ---
    if (!profile.mtowKg && !patch.mtowKg) {
      const faaRow = faaAcd.get(icao);
      if (faaRow) {
        patch.mtowKg = Math.round(faaRow.mtowLb * LB_TO_KG);
        sources.push('faa:mtow');
      }
    }

    // --- FAA ACD: OEW fallback (estimate from MTOW using typical OEW/MTOW ratios) ---
    if (!profile.emptyWeightKg && !patch.emptyWeightKg && (profile.mtowKg || patch.mtowKg)) {
      const mtow = patch.mtowKg ?? profile.mtowKg!;
      // Typical OEW/MTOW: GA ~0.58, regional ~0.55, narrowbody ~0.52, widebody ~0.50
      if (mtow < 5700) patch.emptyWeightKg = Math.round(mtow * 0.58);
      else if (mtow < 25000) patch.emptyWeightKg = Math.round(mtow * 0.56);
      else if (mtow < 100000) patch.emptyWeightKg = Math.round(mtow * 0.53);
      else patch.emptyWeightKg = Math.round(mtow * 0.50);
      if (patch.emptyWeightKg) sources.push('est:oew');
    }

    // --- JSBSim: empty weight + W&B stations ---
    const jsbData = jsbsim.get(icao);
    if (jsbData) {
      if (!profile.emptyWeightKg && !patch.emptyWeightKg && jsbData.emptyWeightKg) {
        patch.emptyWeightKg = jsbData.emptyWeightKg;
        sources.push('jsbsim:oew');
      }
      if (profile.stations.length === 0 && jsbData.stations.length > 0) {
        patch.stations = jsbData.stations;
        sources.push('jsbsim:stations');
      }
    }

    if (sources.length === 0) {
      unchangedCount++;
      continue;
    }

    const updatedFields: Record<string, unknown> = {};
    if (patch.emptyWeightKg) updatedFields.emptyWeightKg = patch.emptyWeightKg;
    if (patch.mtowKg) updatedFields.mtowKg = patch.mtowKg;
    if (patch.fuelBurnLph) updatedFields.fuelBurnLph = patch.fuelBurnLph;

    const completeness = computeDataCompleteness({
      emptyWeightKg: patch.emptyWeightKg ?? profile.emptyWeightKg,
      mtowKg: patch.mtowKg ?? profile.mtowKg,
      fuelCapacityL: profile.fuelCapacityL,
      fuelBurnLph: patch.fuelBurnLph ?? profile.fuelBurnLph,
      cruiseSpeedKts: profile.cruiseSpeedKts,
      stations: patch.stations ?? (profile.stations.length > 0 ? profile.stations : null),
    });

    updatedFields.dataCompleteness = completeness;

    await prisma.aircraftProfile.update({
      where: { id: profile.id },
      data: {
        ...updatedFields,
        ...(patch.stations
          ? {
              stations: {
                deleteMany: {},
                create: patch.stations.map((s) => ({
                  stationId: s.stationId,
                  labelKey: s.labelKey,
                  defaultKg: s.defaultKg,
                  maxKg: s.maxKg,
                  arm: s.arm,
                })),
              },
            }
          : {}),
      },
    });

    console.log(`  ${icao}: ${sources.join(', ')} → ${completeness}`);
    enrichedCount++;
  }

  // Invalidate Redis cache
  try {
    const { createClient } = require('redis');
    const redisUrl = process.env.REDIS_URL ?? 'redis://:redis_dev@localhost:6380';
    const redis = createClient({ url: redisUrl });
    await redis.connect();
    await redis.del('aircraft:catalog');
    await redis.quit();
    console.log('\nRedis: cleared aircraft:catalog cache');
  } catch (err) {
    console.warn('Redis: could not clear cache:', (err as Error).message);
  }

  console.log(`\nEnrichment complete: ${enrichedCount} updated, ${unchangedCount} unchanged`);
}
