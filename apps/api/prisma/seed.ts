/**
 * Database seed script — OurAirports data import
 *
 * Downloads the OurAirports CSV dataset (CC0 license) and upserts
 * medium + large airports with valid 4-letter ICAO codes into the
 * Airport table. Caches the CSV locally for 7 days to avoid
 * repeated downloads during development.
 *
 * Ref: docs/technical-spec.md Section 7
 */

import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as https from 'https';
import * as path from 'path';

const prisma = new PrismaClient();

const OURAIRPORTS_CSV_URL = 'https://davidmegginson.github.io/ourairports-data/airports.csv';
const CACHE_PATH = path.join(__dirname, 'airports-cache.csv');
const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

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

async function seedAirports(): Promise<void> {
  // Use cached CSV if fresh enough
  let needsDownload = true;
  if (fs.existsSync(CACHE_PATH)) {
    const stat = fs.statSync(CACHE_PATH);
    if (Date.now() - stat.mtimeMs < CACHE_MAX_AGE_MS) {
      console.log('Using cached airports CSV');
      needsDownload = false;
    }
  }

  if (needsDownload) {
    console.log('Downloading OurAirports data...');
    await download(OURAIRPORTS_CSV_URL, CACHE_PATH);
    console.log('Download complete');
  }

  const csv = fs.readFileSync(CACHE_PATH, 'utf-8');
  const lines = csv.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    throw new Error('CSV file appears empty or malformed');
  }

  const headers = parseCsvLine(lines[0]);
  const headerMap = new Map(headers.map((h, i) => [h, i]));

  const getField = (fields: string[], name: string): string => {
    const idx = headerMap.get(name);
    return idx !== undefined ? fields[idx] : '';
  };

  // Filter: only medium_airport, large_airport with valid 4-char ICAO codes
  const airports: {
    icao: string;
    iata: string | null;
    name: string;
    city: string | null;
    country: string | null;
    latitude: number;
    longitude: number;
    elevation: number | null;
    raw: object;
  }[] = [];

  for (let i = 1; i < lines.length; i++) {
    const fields = parseCsvLine(lines[i]);
    const airportType = getField(fields, 'type');
    const ident = getField(fields, 'ident');

    if (!['medium_airport', 'large_airport'].includes(airportType)) continue;
    if (!/^[A-Z]{4}$/.test(ident)) continue;

    const lat = parseFloat(getField(fields, 'latitude_deg'));
    const lon = parseFloat(getField(fields, 'longitude_deg'));
    if (isNaN(lat) || isNaN(lon)) continue;

    const elevStr = getField(fields, 'elevation_ft');
    const elevation = elevStr ? parseInt(elevStr, 10) : null;
    const iataCode = getField(fields, 'iata_code');

    const rawRecord: Record<string, string> = {};
    headers.forEach((h) => {
      rawRecord[h] = getField(fields, h);
    });

    airports.push({
      icao: ident,
      iata: iataCode || null,
      name: getField(fields, 'name'),
      city: getField(fields, 'municipality') || null,
      country: getField(fields, 'iso_country') || null,
      latitude: lat,
      longitude: lon,
      elevation: isNaN(elevation as number) ? null : elevation,
      raw: rawRecord,
    });
  }

  console.log(`Parsed ${airports.length} airports (medium + large with ICAO code)`);

  // Upsert in batches
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
            raw: a.raw,
          },
          create: a,
        }),
      ),
    );
    upserted += batch.length;
    console.log(`  Upserted ${upserted}/${airports.length}`);
  }

  console.log(`Seed complete: ${upserted} airports`);
}

async function main(): Promise<void> {
  await seedAirports();
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
