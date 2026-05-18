import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { XMLParser } from 'fast-xml-parser';
import YAML from 'yaml';

// ─── Types ───

interface SeedAircraft {
  icaoType: string;
  name: string;
  manufacturer: string | null;
  model: string | null;
  source: 'curated' | 'openap' | 'lnm' | 'openap+lnm';
  emptyWeightKg: number | null;
  mtowKg: number | null;
  fuelCapacityL: number | null;
  fuelBurnLph: number | null;
  cruiseSpeedKts: number | null;
  stations: WeightStation[] | null;
}

interface WeightStation {
  id: string;
  labelKey: string;
  defaultKg: number;
  maxKg: number;
  arm: number;
}

interface OpenApYaml {
  aircraft: string;
  mtow: number;
  oew: number;
  mfc: number;
  cruise: { mach: number; height: number };
}

interface LnmPerf {
  Name: string;
  AircraftType: string;
  JetFuel: number;
  FuelAsVolume: number;
  UsableFuelLbsGal: number;
  CruiseFuelFlow: number;
  CruiseSpeedKts: number;
}

// ─── Constants ───

const OPENAP_BASE = 'https://raw.githubusercontent.com/junzis/openap/master/openap/data/aircraft';
const OPENAP_ICAOS = [
  'a19n', 'a20n', 'a21n', 'a318', 'a319', 'a320', 'a321', 'a332', 'a333',
  'a343', 'a359', 'a388', 'b37m', 'b38m', 'b39m', 'b3xm', 'b734', 'b737',
  'b738', 'b739', 'b744', 'b748', 'b752', 'b763', 'b772', 'b773', 'b77w',
  'b788', 'b789', 'c550', 'crj9', 'e145', 'e170', 'e190', 'e195', 'e75l', 'glf6',
];

const LNM_DIRS = [
  'https://www.littlenavmap.org/downloads/Aircraft%20Performance/MSFS/',
  'https://www.littlenavmap.org/downloads/Aircraft%20Performance/X-Plane/',
];

const AVGAS_KG_PER_L = 0.72;
const JETA_KG_PER_L = 0.8;
const LBS_PER_KG = 2.20462;
const GAL_PER_L = 0.264172;

// ─── Manufacturer extraction ───

const MANUFACTURER_MAP: Record<string, { manufacturer: string; model: string }> = {
  a19n: { manufacturer: 'Airbus', model: 'A319neo' },
  a20n: { manufacturer: 'Airbus', model: 'A320neo' },
  a21n: { manufacturer: 'Airbus', model: 'A321neo' },
  a318: { manufacturer: 'Airbus', model: 'A318' },
  a319: { manufacturer: 'Airbus', model: 'A319' },
  a320: { manufacturer: 'Airbus', model: 'A320' },
  a321: { manufacturer: 'Airbus', model: 'A321' },
  a332: { manufacturer: 'Airbus', model: 'A330-200' },
  a333: { manufacturer: 'Airbus', model: 'A330-300' },
  a343: { manufacturer: 'Airbus', model: 'A340-300' },
  a359: { manufacturer: 'Airbus', model: 'A350-900' },
  a388: { manufacturer: 'Airbus', model: 'A380-800' },
  b37m: { manufacturer: 'Boeing', model: '737 MAX 7' },
  b38m: { manufacturer: 'Boeing', model: '737 MAX 8' },
  b39m: { manufacturer: 'Boeing', model: '737 MAX 9' },
  b3xm: { manufacturer: 'Boeing', model: '737 MAX 10' },
  b734: { manufacturer: 'Boeing', model: '737-400' },
  b737: { manufacturer: 'Boeing', model: '737-700' },
  b738: { manufacturer: 'Boeing', model: '737-800' },
  b739: { manufacturer: 'Boeing', model: '737-900' },
  b744: { manufacturer: 'Boeing', model: '747-400' },
  b748: { manufacturer: 'Boeing', model: '747-8' },
  b752: { manufacturer: 'Boeing', model: '757-200' },
  b763: { manufacturer: 'Boeing', model: '767-300' },
  b772: { manufacturer: 'Boeing', model: '777-200' },
  b773: { manufacturer: 'Boeing', model: '777-300' },
  b77w: { manufacturer: 'Boeing', model: '777-300ER' },
  b788: { manufacturer: 'Boeing', model: '787-8' },
  b789: { manufacturer: 'Boeing', model: '787-9' },
  c550: { manufacturer: 'Cessna', model: 'Citation II' },
  crj9: { manufacturer: 'Bombardier', model: 'CRJ-900' },
  e145: { manufacturer: 'Embraer', model: 'ERJ-145' },
  e170: { manufacturer: 'Embraer', model: 'E170' },
  e190: { manufacturer: 'Embraer', model: 'E190' },
  e195: { manufacturer: 'Embraer', model: 'E195' },
  e75l: { manufacturer: 'Embraer', model: 'E175' },
  glf6: { manufacturer: 'Gulfstream', model: 'G650' },
};

// Curated W&B stations for ~15 popular GA aircraft (from POH data)
const CURATED_GA: Record<string, {
  name: string; manufacturer: string; model: string;
  emptyWeightKg: number; mtowKg: number; fuelCapacityL: number;
  fuelBurnLph: number; cruiseSpeedKts: number;
  stations: WeightStation[];
}> = {
  C152: {
    name: 'Cessna 152', manufacturer: 'Cessna', model: '152',
    emptyWeightKg: 508, mtowKg: 757, fuelCapacityL: 98, fuelBurnLph: 23, cruiseSpeedKts: 107,
    stations: [
      { id: 'pilot', labelKey: 'aircraft.pilot', defaultKg: 77, maxKg: 120, arm: 39.0 },
      { id: 'copilot', labelKey: 'aircraft.copilot', defaultKg: 0, maxKg: 120, arm: 39.0 },
      { id: 'baggage', labelKey: 'aircraft.baggage', defaultKg: 0, maxKg: 54, arm: 64.0 },
    ],
  },
  C172: {
    name: 'Cessna 172S Skyhawk SP', manufacturer: 'Cessna', model: '172S Skyhawk SP',
    emptyWeightKg: 767, mtowKg: 1111, fuelCapacityL: 212, fuelBurnLph: 34, cruiseSpeedKts: 124,
    stations: [
      { id: 'pilot', labelKey: 'aircraft.pilot', defaultKg: 77, maxKg: 120, arm: 37.0 },
      { id: 'copilot', labelKey: 'aircraft.copilot', defaultKg: 0, maxKg: 120, arm: 37.0 },
      { id: 'rearPax', labelKey: 'aircraft.rearPax', defaultKg: 0, maxKg: 170, arm: 73.0 },
      { id: 'baggage', labelKey: 'aircraft.baggage', defaultKg: 0, maxKg: 54, arm: 95.0 },
    ],
  },
  C182: {
    name: 'Cessna 182T Skylane', manufacturer: 'Cessna', model: '182T Skylane',
    emptyWeightKg: 880, mtowKg: 1406, fuelCapacityL: 303, fuelBurnLph: 49, cruiseSpeedKts: 145,
    stations: [
      { id: 'pilot', labelKey: 'aircraft.pilot', defaultKg: 77, maxKg: 120, arm: 37.0 },
      { id: 'copilot', labelKey: 'aircraft.copilot', defaultKg: 0, maxKg: 120, arm: 37.0 },
      { id: 'rearPax', labelKey: 'aircraft.rearPax', defaultKg: 0, maxKg: 170, arm: 73.0 },
      { id: 'baggage', labelKey: 'aircraft.baggage', defaultKg: 0, maxKg: 91, arm: 95.0 },
    ],
  },
  C206: {
    name: 'Cessna T206H Stationair', manufacturer: 'Cessna', model: 'T206H Stationair',
    emptyWeightKg: 998, mtowKg: 1633, fuelCapacityL: 340, fuelBurnLph: 57, cruiseSpeedKts: 150,
    stations: [
      { id: 'pilot', labelKey: 'aircraft.pilot', defaultKg: 77, maxKg: 120, arm: 37.0 },
      { id: 'copilot', labelKey: 'aircraft.copilot', defaultKg: 0, maxKg: 120, arm: 37.0 },
      { id: 'midPax', labelKey: 'aircraft.midPax', defaultKg: 0, maxKg: 181, arm: 73.0 },
      { id: 'rearPax', labelKey: 'aircraft.rearPax', defaultKg: 0, maxKg: 181, arm: 95.0 },
      { id: 'baggage', labelKey: 'aircraft.baggage', defaultKg: 0, maxKg: 136, arm: 123.0 },
    ],
  },
  P28A: {
    name: 'Piper PA-28-181 Archer', manufacturer: 'Piper', model: 'PA-28-181 Archer',
    emptyWeightKg: 617, mtowKg: 1156, fuelCapacityL: 189, fuelBurnLph: 34, cruiseSpeedKts: 128,
    stations: [
      { id: 'pilot', labelKey: 'aircraft.pilot', defaultKg: 77, maxKg: 120, arm: 80.5 },
      { id: 'copilot', labelKey: 'aircraft.copilot', defaultKg: 0, maxKg: 120, arm: 80.5 },
      { id: 'rearPax', labelKey: 'aircraft.rearPax', defaultKg: 0, maxKg: 170, arm: 118.1 },
      { id: 'baggage', labelKey: 'aircraft.baggage', defaultKg: 0, maxKg: 91, arm: 142.8 },
    ],
  },
  P28R: {
    name: 'Piper PA-28R-201 Arrow', manufacturer: 'Piper', model: 'PA-28R-201 Arrow',
    emptyWeightKg: 694, mtowKg: 1247, fuelCapacityL: 284, fuelBurnLph: 42, cruiseSpeedKts: 141,
    stations: [
      { id: 'pilot', labelKey: 'aircraft.pilot', defaultKg: 77, maxKg: 120, arm: 80.5 },
      { id: 'copilot', labelKey: 'aircraft.copilot', defaultKg: 0, maxKg: 120, arm: 80.5 },
      { id: 'rearPax', labelKey: 'aircraft.rearPax', defaultKg: 0, maxKg: 170, arm: 118.1 },
      { id: 'baggage', labelKey: 'aircraft.baggage', defaultKg: 0, maxKg: 91, arm: 142.8 },
    ],
  },
  PA32: {
    name: 'Piper PA-32R-301 Saratoga', manufacturer: 'Piper', model: 'PA-32R-301 Saratoga',
    emptyWeightKg: 862, mtowKg: 1633, fuelCapacityL: 378, fuelBurnLph: 53, cruiseSpeedKts: 157,
    stations: [
      { id: 'pilot', labelKey: 'aircraft.pilot', defaultKg: 77, maxKg: 120, arm: 80.5 },
      { id: 'copilot', labelKey: 'aircraft.copilot', defaultKg: 0, maxKg: 120, arm: 80.5 },
      { id: 'midPax', labelKey: 'aircraft.midPax', defaultKg: 0, maxKg: 170, arm: 118.1 },
      { id: 'rearPax', labelKey: 'aircraft.rearPax', defaultKg: 0, maxKg: 170, arm: 142.8 },
      { id: 'baggage', labelKey: 'aircraft.baggage', defaultKg: 0, maxKg: 91, arm: 178.7 },
    ],
  },
  PA34: {
    name: 'Piper PA-34-220T Seneca V', manufacturer: 'Piper', model: 'PA-34-220T Seneca V',
    emptyWeightKg: 1263, mtowKg: 2155, fuelCapacityL: 416, fuelBurnLph: 76, cruiseSpeedKts: 178,
    stations: [
      { id: 'pilot', labelKey: 'aircraft.pilot', defaultKg: 77, maxKg: 120, arm: 85.5 },
      { id: 'copilot', labelKey: 'aircraft.copilot', defaultKg: 0, maxKg: 120, arm: 85.5 },
      { id: 'midPax', labelKey: 'aircraft.midPax', defaultKg: 0, maxKg: 170, arm: 118.1 },
      { id: 'rearPax', labelKey: 'aircraft.rearPax', defaultKg: 0, maxKg: 170, arm: 153.0 },
      { id: 'baggage', labelKey: 'aircraft.baggage', defaultKg: 0, maxKg: 91, arm: 178.7 },
    ],
  },
  SR20: {
    name: 'Cirrus SR20', manufacturer: 'Cirrus', model: 'SR20',
    emptyWeightKg: 930, mtowKg: 1383, fuelCapacityL: 227, fuelBurnLph: 38, cruiseSpeedKts: 155,
    stations: [
      { id: 'pilot', labelKey: 'aircraft.pilot', defaultKg: 77, maxKg: 120, arm: 143.5 },
      { id: 'copilot', labelKey: 'aircraft.copilot', defaultKg: 0, maxKg: 120, arm: 143.5 },
      { id: 'rearPax', labelKey: 'aircraft.rearPax', defaultKg: 0, maxKg: 170, arm: 180.0 },
      { id: 'baggage', labelKey: 'aircraft.baggage', defaultKg: 0, maxKg: 57, arm: 215.0 },
    ],
  },
  SR22: {
    name: 'Cirrus SR22', manufacturer: 'Cirrus', model: 'SR22',
    emptyWeightKg: 1009, mtowKg: 1542, fuelCapacityL: 340, fuelBurnLph: 53, cruiseSpeedKts: 176,
    stations: [
      { id: 'pilot', labelKey: 'aircraft.pilot', defaultKg: 77, maxKg: 120, arm: 143.5 },
      { id: 'copilot', labelKey: 'aircraft.copilot', defaultKg: 0, maxKg: 120, arm: 143.5 },
      { id: 'rearPax', labelKey: 'aircraft.rearPax', defaultKg: 0, maxKg: 170, arm: 180.0 },
      { id: 'baggage', labelKey: 'aircraft.baggage', defaultKg: 0, maxKg: 57, arm: 215.0 },
    ],
  },
  DA40: {
    name: 'Diamond DA40 Diamond Star', manufacturer: 'Diamond', model: 'DA40 Diamond Star',
    emptyWeightKg: 798, mtowKg: 1150, fuelCapacityL: 148, fuelBurnLph: 30, cruiseSpeedKts: 140,
    stations: [
      { id: 'pilot', labelKey: 'aircraft.pilot', defaultKg: 77, maxKg: 120, arm: 2.40 },
      { id: 'copilot', labelKey: 'aircraft.copilot', defaultKg: 0, maxKg: 120, arm: 2.40 },
      { id: 'rearPax', labelKey: 'aircraft.rearPax', defaultKg: 0, maxKg: 170, arm: 3.27 },
      { id: 'baggage', labelKey: 'aircraft.baggage', defaultKg: 0, maxKg: 45, arm: 4.07 },
    ],
  },
  DA42: {
    name: 'Diamond DA42 Twin Star', manufacturer: 'Diamond', model: 'DA42 Twin Star',
    emptyWeightKg: 1280, mtowKg: 1785, fuelCapacityL: 296, fuelBurnLph: 42, cruiseSpeedKts: 176,
    stations: [
      { id: 'pilot', labelKey: 'aircraft.pilot', defaultKg: 77, maxKg: 120, arm: 2.40 },
      { id: 'copilot', labelKey: 'aircraft.copilot', defaultKg: 0, maxKg: 120, arm: 2.40 },
      { id: 'rearPax', labelKey: 'aircraft.rearPax', defaultKg: 0, maxKg: 170, arm: 3.27 },
      { id: 'baggage', labelKey: 'aircraft.baggage', defaultKg: 0, maxKg: 45, arm: 4.07 },
    ],
  },
  DA62: {
    name: 'Diamond DA62', manufacturer: 'Diamond', model: 'DA62',
    emptyWeightKg: 1410, mtowKg: 2300, fuelCapacityL: 326, fuelBurnLph: 48, cruiseSpeedKts: 192,
    stations: [
      { id: 'pilot', labelKey: 'aircraft.pilot', defaultKg: 77, maxKg: 120, arm: 2.40 },
      { id: 'copilot', labelKey: 'aircraft.copilot', defaultKg: 0, maxKg: 120, arm: 2.40 },
      { id: 'midPax', labelKey: 'aircraft.midPax', defaultKg: 0, maxKg: 170, arm: 3.27 },
      { id: 'rearPax', labelKey: 'aircraft.rearPax', defaultKg: 0, maxKg: 170, arm: 3.80 },
      { id: 'baggage', labelKey: 'aircraft.baggage', defaultKg: 0, maxKg: 50, arm: 4.30 },
    ],
  },
  BE36: {
    name: 'Beechcraft A36 Bonanza', manufacturer: 'Beechcraft', model: 'A36 Bonanza',
    emptyWeightKg: 1042, mtowKg: 1656, fuelCapacityL: 318, fuelBurnLph: 53, cruiseSpeedKts: 168,
    stations: [
      { id: 'pilot', labelKey: 'aircraft.pilot', defaultKg: 77, maxKg: 120, arm: 82.0 },
      { id: 'copilot', labelKey: 'aircraft.copilot', defaultKg: 0, maxKg: 120, arm: 82.0 },
      { id: 'midPax', labelKey: 'aircraft.midPax', defaultKg: 0, maxKg: 170, arm: 121.0 },
      { id: 'rearPax', labelKey: 'aircraft.rearPax', defaultKg: 0, maxKg: 170, arm: 145.0 },
      { id: 'baggage', labelKey: 'aircraft.baggage', defaultKg: 0, maxKg: 136, arm: 168.0 },
    ],
  },
  BE58: {
    name: 'Beechcraft Baron 58', manufacturer: 'Beechcraft', model: 'Baron 58',
    emptyWeightKg: 1564, mtowKg: 2449, fuelCapacityL: 536, fuelBurnLph: 91, cruiseSpeedKts: 190,
    stations: [
      { id: 'pilot', labelKey: 'aircraft.pilot', defaultKg: 77, maxKg: 120, arm: 82.0 },
      { id: 'copilot', labelKey: 'aircraft.copilot', defaultKg: 0, maxKg: 120, arm: 82.0 },
      { id: 'midPax', labelKey: 'aircraft.midPax', defaultKg: 0, maxKg: 170, arm: 121.0 },
      { id: 'rearPax', labelKey: 'aircraft.rearPax', defaultKg: 0, maxKg: 170, arm: 145.0 },
      { id: 'baggage', labelKey: 'aircraft.baggage', defaultKg: 0, maxKg: 181, arm: 168.0 },
    ],
  },
};

// ─── OpenAP Fetching ───

async function fetchOpenAp(): Promise<Map<string, SeedAircraft>> {
  const result = new Map<string, SeedAircraft>();
  console.log(`Fetching ${OPENAP_ICAOS.length} OpenAP aircraft...`);

  for (const icao of OPENAP_ICAOS) {
    try {
      const url = `${OPENAP_BASE}/${icao}.yml`;
      const resp = await fetch(url);
      if (!resp.ok) { console.warn(`  Skip ${icao}: HTTP ${resp.status}`); continue; }

      const text = await resp.text();
      const data = YAML.parse(text) as OpenApYaml;

      const info = MANUFACTURER_MAP[icao];
      const fuelCapacityKg = data.mfc;
      const fuelCapacityL = Math.round(fuelCapacityKg / JETA_KG_PER_L);
      const cruiseMach = data.cruise?.mach ?? 0.78;
      const cruiseAltM = data.cruise?.height ?? 11000;
      const tempK = 288.15 - 0.0065 * cruiseAltM;
      const speedOfSound = Math.sqrt(1.4 * 287.05 * tempK) * 1.944;
      const cruiseSpeedKts = Math.round(cruiseMach * speedOfSound);

      result.set(icao.toUpperCase(), {
        icaoType: icao.toUpperCase(),
        name: data.aircraft,
        manufacturer: info?.manufacturer ?? null,
        model: info?.model ?? null,
        source: 'openap',
        emptyWeightKg: data.oew,
        mtowKg: data.mtow,
        fuelCapacityL,
        fuelBurnLph: null,
        cruiseSpeedKts,
        stations: null,
      });
    } catch (err) {
      console.warn(`  Error fetching ${icao}: ${(err as Error).message}`);
    }
  }

  console.log(`  Fetched ${result.size} OpenAP aircraft`);
  return result;
}

// ─── LNM Fetching ───

async function listLnmFiles(dirUrl: string): Promise<string[]> {
  try {
    const resp = await fetch(dirUrl);
    if (!resp.ok) return [];
    const html = await resp.text();
    const matches = html.match(/href="([^"]*\.lnmperf)"/g) ?? [];
    return matches.map((m) => {
      const filename = m.replace('href="', '').replace('"', '');
      return `${dirUrl}${filename}`;
    });
  } catch {
    return [];
  }
}

function parseLnmXml(xml: string): LnmPerf | null {
  const parser = new XMLParser({ ignoreAttributes: false });
  try {
    const doc = parser.parse(xml);
    const ap = doc?.LittleNavmap?.AircraftPerf;
    if (!ap) return null;

    const opts = ap.Options ?? {};
    const perf = ap.Perf ?? {};

    const icao = opts.AircraftType;
    if (!icao || typeof icao !== 'string' || icao.length < 2 || icao.length > 4) return null;

    return {
      Name: opts.Name ?? '',
      AircraftType: icao.toUpperCase(),
      JetFuel: Number(opts.JetFuel ?? 0),
      FuelAsVolume: Number(opts.FuelAsVolume ?? 0),
      UsableFuelLbsGal: Number(perf.UsableFuelLbsGal ?? 0),
      CruiseFuelFlow: Number(perf.Cruise?.FuelFlowLbsGalPerHour ?? 0),
      CruiseSpeedKts: Math.round(Number(perf.Cruise?.SpeedKtsTAS ?? 0)),
    };
  } catch {
    return null;
  }
}

function lnmToSeedAircraft(lnm: LnmPerf): SeedAircraft {
  const isJet = lnm.JetFuel === 1;
  const isVolume = lnm.FuelAsVolume === 1;

  let fuelCapacityL: number;
  if (isVolume) {
    fuelCapacityL = Math.round(lnm.UsableFuelLbsGal / GAL_PER_L);
  } else {
    const fuelKg = lnm.UsableFuelLbsGal / LBS_PER_KG;
    const densityKgPerL = isJet ? JETA_KG_PER_L : AVGAS_KG_PER_L;
    fuelCapacityL = Math.round(fuelKg / densityKgPerL);
  }

  let fuelBurnLph: number | null = null;
  if (lnm.CruiseFuelFlow > 0) {
    if (isVolume) {
      fuelBurnLph = Math.round(lnm.CruiseFuelFlow / GAL_PER_L);
    } else {
      const flowKgH = lnm.CruiseFuelFlow / LBS_PER_KG;
      const densityKgPerL = isJet ? JETA_KG_PER_L : AVGAS_KG_PER_L;
      fuelBurnLph = Math.round(flowKgH / densityKgPerL);
    }
  }

  const nameParts = lnm.Name.split(/\s+/);
  const manufacturer = nameParts[0] ?? null;
  const model = nameParts.slice(1).join(' ') || null;

  return {
    icaoType: lnm.AircraftType,
    name: lnm.Name,
    manufacturer,
    model,
    source: 'lnm',
    emptyWeightKg: null,
    mtowKg: null,
    fuelCapacityL: fuelCapacityL > 0 ? fuelCapacityL : null,
    fuelBurnLph,
    cruiseSpeedKts: lnm.CruiseSpeedKts > 0 ? lnm.CruiseSpeedKts : null,
    stations: null,
  };
}

async function fetchLnm(): Promise<Map<string, SeedAircraft>> {
  const result = new Map<string, SeedAircraft>();
  console.log('Fetching Little Navmap performance files...');

  for (const dir of LNM_DIRS) {
    const files = await listLnmFiles(dir);
    console.log(`  Found ${files.length} files in ${dir.split('/').slice(-2, -1)[0]}`);

    for (const url of files) {
      try {
        const resp = await fetch(url);
        if (!resp.ok) continue;
        const xml = await resp.text();
        const parsed = parseLnmXml(xml);
        if (!parsed) continue;

        if (result.has(parsed.AircraftType)) continue;

        result.set(parsed.AircraftType, lnmToSeedAircraft(parsed));
      } catch {
        // skip bad files
      }
    }
  }

  console.log(`  Fetched ${result.size} unique LNM aircraft`);
  return result;
}

// ─── Merge ───

function mergeData(openap: Map<string, SeedAircraft>, lnm: Map<string, SeedAircraft>): SeedAircraft[] {
  const merged = new Map<string, SeedAircraft>();

  // 1. Curated GA first (highest priority)
  for (const [icao, data] of Object.entries(CURATED_GA)) {
    merged.set(icao, { icaoType: icao, ...data, source: 'curated' });
  }

  // 2. OpenAP jets
  for (const [icao, aircraft] of openap) {
    if (merged.has(icao)) continue;

    const lnmData = lnm.get(icao);
    if (lnmData) {
      merged.set(icao, {
        ...aircraft,
        source: 'openap+lnm',
        fuelBurnLph: lnmData.fuelBurnLph ?? aircraft.fuelBurnLph,
        cruiseSpeedKts: aircraft.cruiseSpeedKts ?? lnmData.cruiseSpeedKts,
      });
    } else {
      merged.set(icao, aircraft);
    }
  }

  // 3. LNM (not already covered)
  for (const [icao, aircraft] of lnm) {
    if (merged.has(icao)) continue;
    merged.set(icao, aircraft);
  }

  const sorted = [...merged.values()].sort((a, b) => a.icaoType.localeCompare(b.icaoType));
  return sorted;
}

// ─── Main ───

async function main() {
  console.log('=== Aircraft Data Extraction ===\n');

  const openap = await fetchOpenAp();
  console.log();
  const lnm = await fetchLnm();
  console.log();

  const merged = mergeData(openap, lnm);

  const curated = merged.filter((a) => a.source === 'curated').length;
  const openapOnly = merged.filter((a) => a.source === 'openap').length;
  const openapLnm = merged.filter((a) => a.source === 'openap+lnm').length;
  const lnmOnly = merged.filter((a) => a.source === 'lnm').length;

  console.log('=== Merge Summary ===');
  console.log(`  Curated (with stations): ${curated}`);
  console.log(`  OpenAP only:             ${openapOnly}`);
  console.log(`  OpenAP + LNM:            ${openapLnm}`);
  console.log(`  LNM only:                ${lnmOnly}`);
  console.log(`  Total:                   ${merged.length}`);

  const outPath = resolve(import.meta.dirname, '../apps/api/prisma/data/aircraft-seed-data.json');
  writeFileSync(outPath, JSON.stringify(merged, null, 2) + '\n');
  console.log(`\nWritten to ${outPath}`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
