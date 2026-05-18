import type { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as https from 'https';
import * as path from 'path';

import { computeDataCompleteness } from '@fs-suite/types';

interface SeedStation {
  id: string;
  labelKey: string;
  defaultKg: number;
  maxKg: number;
  arm: number;
}

interface SeedEntry {
  icaoType: string;
  name: string;
  manufacturer: string | null;
  model: string | null;
  source: string;
  emptyWeightKg: number | null;
  mtowKg: number | null;
  fuelCapacityL: number | null;
  fuelBurnLph: number | null;
  cruiseSpeedKts: number | null;
  stations: SeedStation[] | null;
}

interface SimBriefAirframe {
  icao: string;
  name: string;
}

function fetchJson(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const request = (reqUrl: string): void => {
      https
        .get(reqUrl, (res) => {
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

async function fetchSimBriefAirframes(): Promise<SimBriefAirframe[]> {
  const raw = await fetchJson('https://www.simbrief.com/api/inputs.airframes.json');
  const parsed = JSON.parse(raw) as Record<string, { icao?: string; name?: string }>;

  const airframes: SimBriefAirframe[] = [];
  for (const value of Object.values(parsed)) {
    if (value.icao && value.name) {
      airframes.push({ icao: value.icao, name: value.name });
    }
  }
  return airframes;
}

function toStationCreate(s: SeedStation) {
  return { stationId: s.id, labelKey: s.labelKey, defaultKg: s.defaultKg, maxKg: s.maxKg, arm: s.arm };
}

export async function seedAircraft(prisma: PrismaClient): Promise<void> {
  const seedPath = path.join(__dirname, 'data', 'aircraft-seed-data.json');
  const preExtracted: SeedEntry[] = JSON.parse(fs.readFileSync(seedPath, 'utf-8'));

  console.log(`Loaded ${preExtracted.length} pre-extracted aircraft`);

  const coveredIcaos = new Set(preExtracted.map((a) => a.icaoType));

  let simbriefOnly: SimBriefAirframe[] = [];
  try {
    const allSimbrief = await fetchSimBriefAirframes();
    simbriefOnly = allSimbrief.filter((s) => !coveredIcaos.has(s.icao));
    console.log(`SimBrief: ${allSimbrief.length} total, ${simbriefOnly.length} new ICAO types`);
  } catch (err) {
    console.warn('SimBrief fetch failed, continuing with pre-extracted only:', (err as Error).message);
  }

  let upserted = 0;

  for (const entry of preExtracted) {
    const existing = await prisma.aircraftProfile.findFirst({
      where: { icaoType: entry.icaoType, isTemplate: true, userId: null },
    });

    const completeness = computeDataCompleteness({
      emptyWeightKg: entry.emptyWeightKg,
      mtowKg: entry.mtowKg,
      fuelCapacityL: entry.fuelCapacityL,
      fuelBurnLph: entry.fuelBurnLph,
      cruiseSpeedKts: entry.cruiseSpeedKts,
      stations: entry.stations,
    });

    const baseData = {
      name: entry.name,
      icaoType: entry.icaoType,
      manufacturer: entry.manufacturer,
      model: entry.model,
      emptyWeightKg: entry.emptyWeightKg,
      mtowKg: entry.mtowKg,
      fuelCapacityL: entry.fuelCapacityL,
      fuelBurnLph: entry.fuelBurnLph,
      cruiseSpeedKts: entry.cruiseSpeedKts,
      source: entry.source,
      dataCompleteness: completeness,
      isTemplate: true,
      userId: null,
    };

    const stationEntries = entry.stations?.map(toStationCreate) ?? [];

    if (existing) {
      await prisma.aircraftProfile.update({
        where: { id: existing.id },
        data: {
          ...baseData,
          stations: {
            deleteMany: {},
            ...(stationEntries.length > 0 ? { create: stationEntries } : {}),
          },
        },
      });
    } else {
      await prisma.aircraftProfile.create({
        data: {
          ...baseData,
          ...(stationEntries.length > 0 ? { stations: { create: stationEntries } } : {}),
        },
      });
    }
    upserted++;
  }

  console.log(`Pre-extracted aircraft upserted: ${upserted}`);

  let simbriefCreated = 0;
  for (const sb of simbriefOnly) {
    const existing = await prisma.aircraftProfile.findFirst({
      where: { icaoType: sb.icao, isTemplate: true, userId: null },
    });

    if (existing) continue;

    await prisma.aircraftProfile.create({
      data: {
        name: sb.name,
        icaoType: sb.icao,
        source: 'simbrief',
        dataCompleteness: 'skeleton',
        isTemplate: true,
        userId: null,
      },
    });
    simbriefCreated++;
  }

  console.log(`SimBrief skeleton aircraft created: ${simbriefCreated}`);
  console.log(`Aircraft seed complete: ${upserted + simbriefCreated} total`);
}
