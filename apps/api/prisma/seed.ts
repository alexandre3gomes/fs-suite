/**
 * Database seed script — OurAirports data import
 *
 * Downloads OurAirports CSV datasets (CC0 license) and upserts
 * airports with valid ICAO codes + their runways into the database.
 * Caches CSVs locally for 7 days to avoid repeated downloads.
 *
 * Ref: docs/vfr-flight-planning-spec.md Section 9
 */

import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as https from 'https';
import * as path from 'path';

const prisma = new PrismaClient();

const AIRPORTS_CSV_URL = 'https://davidmegginson.github.io/ourairports-data/airports.csv';
const RUNWAYS_CSV_URL = 'https://davidmegginson.github.io/ourairports-data/runways.csv';
const FREQUENCIES_CSV_URL = 'https://davidmegginson.github.io/ourairports-data/airport-frequencies.csv';
const AIRPORTS_CACHE = path.join(__dirname, 'airports-cache.csv');
const RUNWAYS_CACHE = path.join(__dirname, 'runways-cache.csv');
const FREQUENCIES_CACHE = path.join(__dirname, 'frequencies-cache.csv');
const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const ALLOWED_TYPES = ['large_airport', 'medium_airport', 'small_airport'];

/** Download file via HTTPS, following redirects */
function download(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
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
          res.pipe(file);
          file.on('finish', () => {
            file.close();
            resolve();
          });
        })
        .on('error', (err) => {
          fs.unlinkSync(dest);
          reject(err);
        });
    };
    request(url);
  });
}

/** Simple CSV line parser handling quoted fields */
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ',') {
        fields.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
  }
  fields.push(current.trim());
  return fields;
}

async function ensureCached(url: string, cachePath: string, label: string): Promise<void> {
  if (fs.existsSync(cachePath)) {
    const stat = fs.statSync(cachePath);
    if (Date.now() - stat.mtimeMs < CACHE_MAX_AGE_MS) {
      console.log(`Using cached ${label}`);
      return;
    }
  }
  console.log(`Downloading ${label}...`);
  await download(url, cachePath);
  console.log(`Download complete: ${label}`);
}

function readCsv(filePath: string): { headers: string[]; headerMap: Map<string, number>; lines: string[] } {
  const csv = fs.readFileSync(filePath, 'utf-8');
  const lines = csv.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length < 2) throw new Error('CSV file appears empty or malformed');
  const headers = parseCsvLine(lines[0]!);
  const headerMap = new Map(headers.map((h, i) => [h, i]));
  return { headers, headerMap, lines };
}

function getField(fields: string[], headerMap: Map<string, number>, name: string): string {
  const idx = headerMap.get(name);
  return idx !== undefined ? (fields[idx] ?? '') : '';
}

async function seedAirports(): Promise<void> {
  await ensureCached(AIRPORTS_CSV_URL, AIRPORTS_CACHE, 'airports CSV');
  const { headers, headerMap, lines } = readCsv(AIRPORTS_CACHE);

  const airports: {
    icao: string;
    iata: string | null;
    name: string;
    city: string | null;
    country: string | null;
    latitude: number;
    longitude: number;
    elevation: number | null;
    type: string | null;
    raw: object;
  }[] = [];

  for (let i = 1; i < lines.length; i++) {
    const fields = parseCsvLine(lines[i]!);
    const airportType = getField(fields, headerMap, 'type');
    const ident = getField(fields, headerMap, 'ident');

    if (!ALLOWED_TYPES.includes(airportType)) continue;
    if (!/^[A-Z]{4}$/.test(ident)) continue;

    const lat = parseFloat(getField(fields, headerMap, 'latitude_deg'));
    const lon = parseFloat(getField(fields, headerMap, 'longitude_deg'));
    if (isNaN(lat) || isNaN(lon)) continue;

    const elevStr = getField(fields, headerMap, 'elevation_ft');
    const elevation = elevStr ? parseInt(elevStr, 10) : null;
    const iataCode = getField(fields, headerMap, 'iata_code');

    const rawRecord: Record<string, string> = {};
    headers.forEach((h) => {
      rawRecord[h] = getField(fields, headerMap, h);
    });

    airports.push({
      icao: ident,
      iata: iataCode || null,
      name: getField(fields, headerMap, 'name'),
      city: getField(fields, headerMap, 'municipality') || null,
      country: getField(fields, headerMap, 'iso_country') || null,
      latitude: lat,
      longitude: lon,
      elevation: isNaN(elevation as number) ? null : elevation,
      type: airportType,
      raw: rawRecord,
    });
  }

  console.log(`Parsed ${airports.length} airports (${ALLOWED_TYPES.join(', ')})`);

  const BATCH_SIZE = 500;
  let upserted = 0;

  for (let i = 0; i < airports.length; i += BATCH_SIZE) {
    const batch = airports.slice(i, i + BATCH_SIZE);
    await prisma.$transaction(
      batch.map((a) =>
        prisma.airport.upsert({
          where: { icao: a.icao },
          update: {
            iata: a.iata,
            name: a.name,
            city: a.city,
            country: a.country,
            latitude: a.latitude,
            longitude: a.longitude,
            elevation: a.elevation,
            type: a.type,
            raw: a.raw,
          },
          create: a,
        }),
      ),
    );
    upserted += batch.length;
    if (upserted % 2000 === 0 || upserted === airports.length) {
      console.log(`  Airports: ${upserted}/${airports.length}`);
    }
  }

  console.log(`Airports seed complete: ${upserted}`);
  return;
}

async function seedRunways(): Promise<void> {
  await ensureCached(RUNWAYS_CSV_URL, RUNWAYS_CACHE, 'runways CSV');
  const { headerMap, lines } = readCsv(RUNWAYS_CACHE);

  // Build a set of airport ICAOs in the database for FK validation
  const existingAirports = await prisma.airport.findMany({ select: { icao: true } });
  const icaoSet = new Set(existingAirports.map((a) => a.icao));

  // Clear existing runways to avoid duplicates on re-seed
  await prisma.runway.deleteMany({});
  console.log('Cleared existing runways');

  const runways: {
    airportIcao: string;
    ident: string;
    lengthFt: number | null;
    widthFt: number | null;
    surfaceType: string | null;
    leIdent: string | null;
    leHeadingDeg: number | null;
    leElevationFt: number | null;
    heIdent: string | null;
    heHeadingDeg: number | null;
    heElevationFt: number | null;
    closed: boolean;
  }[] = [];

  for (let i = 1; i < lines.length; i++) {
    const fields = parseCsvLine(lines[i]!);
    const airportIdent = getField(fields, headerMap, 'airport_ident');

    if (!icaoSet.has(airportIdent)) continue;

    const leIdent = getField(fields, headerMap, 'le_ident') || null;
    const heIdent = getField(fields, headerMap, 'he_ident') || null;
    const ident = [leIdent, heIdent].filter(Boolean).join('/') || 'UNKNOWN';

    const parseNum = (val: string): number | null => {
      const n = parseFloat(val);
      return isNaN(n) ? null : n;
    };
    const parseInt10 = (val: string): number | null => {
      const n = parseInt(val, 10);
      return isNaN(n) ? null : n;
    };

    runways.push({
      airportIcao: airportIdent,
      ident,
      lengthFt: parseInt10(getField(fields, headerMap, 'length_ft')),
      widthFt: parseInt10(getField(fields, headerMap, 'width_ft')),
      surfaceType: getField(fields, headerMap, 'surface') || null,
      leIdent,
      leHeadingDeg: parseNum(getField(fields, headerMap, 'le_heading_degT')),
      leElevationFt: parseInt10(getField(fields, headerMap, 'le_elevation_ft')),
      heIdent,
      heHeadingDeg: parseNum(getField(fields, headerMap, 'he_heading_degT')),
      heElevationFt: parseInt10(getField(fields, headerMap, 'he_elevation_ft')),
      closed: getField(fields, headerMap, 'closed') === '1',
    });
  }

  console.log(`Parsed ${runways.length} runways for seeded airports`);

  const BATCH_SIZE = 500;
  let created = 0;

  for (let i = 0; i < runways.length; i += BATCH_SIZE) {
    const batch = runways.slice(i, i + BATCH_SIZE);
    await prisma.runway.createMany({ data: batch });
    created += batch.length;
    if (created % 2000 === 0 || created === runways.length) {
      console.log(`  Runways: ${created}/${runways.length}`);
    }
  }

  console.log(`Runways seed complete: ${created}`);
}

async function seedFrequencies(): Promise<void> {
  await ensureCached(FREQUENCIES_CSV_URL, FREQUENCIES_CACHE, 'frequencies CSV');
  const { headerMap, lines } = readCsv(FREQUENCIES_CACHE);

  const existingAirports = await prisma.airport.findMany({ select: { icao: true } });
  const icaoSet = new Set(existingAirports.map((a) => a.icao));

  await prisma.frequency.deleteMany({});
  console.log('Cleared existing frequencies');

  const frequencies: {
    airportIcao: string;
    type: string;
    description: string;
    frequencyMhz: number;
  }[] = [];

  for (let i = 1; i < lines.length; i++) {
    const fields = parseCsvLine(lines[i]!);
    const airportIdent = getField(fields, headerMap, 'airport_ident');

    if (!icaoSet.has(airportIdent)) continue;

    const freqStr = getField(fields, headerMap, 'frequency_mhz');
    const freq = parseFloat(freqStr);
    if (isNaN(freq) || freq <= 0) continue;

    const freqType = getField(fields, headerMap, 'type') || 'OTHER';
    const desc = getField(fields, headerMap, 'description') || freqType;

    frequencies.push({
      airportIcao: airportIdent,
      type: freqType,
      description: desc,
      frequencyMhz: freq,
    });
  }

  console.log(`Parsed ${frequencies.length} frequencies for seeded airports`);

  const BATCH_SIZE = 500;
  let created = 0;

  for (let i = 0; i < frequencies.length; i += BATCH_SIZE) {
    const batch = frequencies.slice(i, i + BATCH_SIZE);
    await prisma.frequency.createMany({ data: batch });
    created += batch.length;
    if (created % 5000 === 0 || created === frequencies.length) {
      console.log(`  Frequencies: ${created}/${frequencies.length}`);
    }
  }

  console.log(`Frequencies seed complete: ${created}`);
}

async function main(): Promise<void> {
  await seedAirports();
  await seedRunways();
  await seedFrequencies();
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
