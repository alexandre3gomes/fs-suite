/**
 * Refresh the curated Portugal VFR dataset from NAV Portugal's eVFR
 * (Manual VFR, ais.nav.pt).
 *
 * Parses:
 *  - ENR 3.5 "Outras Rotas" — mandatory VFR tunnels/routes in the Lisboa,
 *    Porto and Faro TMAs (route name, ordered points, per-leg MAG courses and
 *    altitude limits).
 *  - ENR 4.4 — VFR significant points (visual reporting points) with the
 *    routes they belong to.
 *
 * Output: src/pt-vfr/data/pt-vfr.json (versioned in the repo — the API serves
 * this file statically; there is no runtime scraping of ais.nav.pt).
 *
 * Run on AIRAC amendments affecting the eVFR (see https://ais.nav.pt news):
 *   pnpm --filter @fs-suite/api pt-vfr:refresh
 * then review the diff and commit.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const EVFR_BASE =
  'https://ais.nav.pt/wp-content/uploads/AIS_Files/eVFR_Current/eVFR_Online/eAIP/html/eAIP';
const ENR_35_URL = `${EVFR_BASE}/LP-ENR-3.5-pt-PT.html`;
const ENR_44_URL = `${EVFR_BASE}/LP-ENR-4.4-pt-PT.html`;

// ais.nav.pt sits behind Cloudflare bot protection that 403s non-browser UAs.
const FETCH_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
};

// ---------- Output shapes (mirrored by apps/api/src/pt-vfr/pt-vfr.service.ts) ----------

interface PtVfrRoutePoint {
  name: string;
  lat: number;
  lon: number;
}

interface PtVfrRouteLeg {
  fromIdx: number;
  toIdx: number;
  /** MAG course flying the leg in listed order (null = direction not authorized). */
  courseAtoB: number | null;
  /** MAG course flying the leg against listed order (null = direction not authorized). */
  courseBtoA: number | null;
  upperFt: number | null;
  lowerFt: number | null;
}

interface PtVfrRoute {
  id: string;
  name: string;
  /** TMA grouping: Lisboa | Porto | Faro */
  area: string;
  points: PtVfrRoutePoint[];
  legs: PtVfrRouteLeg[];
}

interface PtVfrPoint {
  name: string;
  lat: number;
  lon: number;
  /** Route names this point belongs to, as published in ENR 4.4 remarks. */
  routes: string[];
}

// ---------- Helpers ----------

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
    .replace(/&nbsp;/g, ' ')
    .replace(/ /g, ' ');
}

/** Strip tags to cell-separated text parts. */
function rowParts(rowHtml: string): string[] {
  const text = decodeEntities(rowHtml.replace(/<[^>]+>/g, '|'));
  return text
    .split('|')
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter((p) => p.length > 0);
}

/** Parse "38 25 27N 009 11 08W" (or split lat/lon) into decimal degrees. */
function parseCoordPair(s: string): { lat: number; lon: number } | null {
  const m = s.match(/(\d{2})\s*(\d{2})\s*(\d{2})([NS])\s+(\d{3})\s*(\d{2})\s*(\d{2})([EW])/);
  if (!m) return null;
  let lat = Number(m[1]) + Number(m[2]) / 60 + Number(m[3]) / 3600;
  if (m[4] === 'S') lat = -lat;
  let lon = Number(m[5]) + Number(m[6]) / 60 + Number(m[7]) / 3600;
  if (m[8] === 'W') lon = -lon;
  return { lat: Number(lat.toFixed(6)), lon: Number(lon.toFixed(6)) };
}

function parseLat(s: string): number | null {
  const m = s.match(/^(\d{2})\s*(\d{2})\s*(\d{2})([NS])$/);
  if (!m) return null;
  const v = Number(m[1]) + Number(m[2]) / 60 + Number(m[3]) / 3600;
  return Number((m[4] === 'S' ? -v : v).toFixed(6));
}

function parseLon(s: string): number | null {
  const m = s.match(/^(\d{3})\s*(\d{2})\s*(\d{2})([EW])$/);
  if (!m) return null;
  const v = Number(m[1]) + Number(m[2]) / 60 + Number(m[3]) / 3600;
  return Number((m[4] === 'W' ? -v : v).toFixed(6));
}

/** "1500 FT" → 1500; "FL045"/"FL 45" → 4500; "—" → null. */
function parseAltitude(s: string): number | null {
  const flMatch = s.match(/^FL\s*(\d+)$/i);
  if (flMatch) return Number(flMatch[1]) * 100;
  const ftMatch = s.match(/^(\d+)\s*FT$/i);
  if (ftMatch) return Number(ftMatch[1]);
  return null;
}

/** "188" → 188; "—"/"-" → null (direction not authorized). */
function parseCourse(s: string): number | null {
  const m = s.match(/^(\d{3})$/);
  return m ? Number(m[1]) : null;
}

function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function fetchPage(url: string): Promise<string> {
  const resp = await fetch(url, { headers: FETCH_HEADERS, signal: AbortSignal.timeout(30000) });
  if (!resp.ok) throw new Error(`${url} returned HTTP ${resp.status}`);
  return resp.text();
}

/** Extract the eAIP "valid from DD MMM YYYY" banner as ISO date, if present. */
function extractEffectiveDate(html: string): string | null {
  const m = decodeEntities(html.replace(/<[^>]+>/g, ' ')).match(
    /valid from\s+(\d{1,2})\s+([A-Z]{3})\s+(\d{4})/i,
  );
  if (!m) return null;
  const months: Record<string, string> = {
    JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06',
    JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12',
  };
  const mm = months[m[2]!.toUpperCase()];
  if (!mm) return null;
  return `${m[3]}-${mm}-${m[1]!.padStart(2, '0')}`;
}

// ---------- ENR 3.5 — routes ----------

function parseEnr35(html: string): PtVfrRoute[] {
  // Area headings ("Rotas VFR na TMA de Lisboa/do Porto/de Faro") may have tags
  // between words — match tolerantly and record document positions.
  const areaPositions: { pos: number; area: string }[] = [];
  const areaRe = /TMA(?:\s|<[^>]+>|&nbsp;)*d[eo](?:\s|<[^>]+>|&nbsp;)*(Lisboa|Porto|Faro)/g;
  let am: RegExpExecArray | null;
  while ((am = areaRe.exec(html)) !== null) {
    areaPositions.push({ pos: am.index, area: am[1]! });
  }
  const areaFor = (pos: number): string => {
    let current = areaPositions[0]?.area ?? 'Portugal';
    for (const { pos: p, area } of areaPositions) {
      if (p <= pos) current = area;
      else break;
    }
    return current;
  };

  const routes: PtVfrRoute[] = [];
  let current: (Omit<PtVfrRoute, 'legs'> & { rawLegs: (string[] | null)[] }) | null = null;
  let pendingLeg: string[] = [];

  const flush = () => {
    if (!current || current.points.length < 2) { current = null; return; }
    const legs: PtVfrRouteLeg[] = [];
    for (let i = 1; i < current.points.length; i++) {
      const raw = current.rawLegs[i] ?? [];
      // Row order between two points: course table-down, course table-up, upper, lower.
      const courses = raw.filter((v) => /^(\d{3}|—|-)$/.test(v));
      const alts = raw.filter((v) => /FT$|^FL/i.test(v));
      legs.push({
        fromIdx: i - 1,
        toIdx: i,
        courseAtoB: courses[0] != null ? parseCourse(courses[0]) : null,
        courseBtoA: courses[1] != null ? parseCourse(courses[1]) : null,
        upperFt: alts[0] != null ? parseAltitude(alts[0]) : null,
        lowerFt: alts[1] != null ? parseAltitude(alts[1]) : null,
      });
    }
    routes.push({ id: slugify(current.name), name: current.name, area: current.area, points: current.points, legs });
    current = null;
  };

  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
  let rm: RegExpExecArray | null;
  while ((rm = rowRe.exec(html)) !== null) {
    const parts = rowParts(rm[1]!);
    if (parts.length === 0) continue;
    const joined = parts.join(' ');

    // Header/decoration rows
    if (/Route Designator|Significant Point Name|Upper limit|Rumo MAG|^Rumo$|^MAG$/.test(joined) && !joined.includes('∆')) continue;
    if (parts.every((p) => p === '↓' || p === '↑')) continue;

    // Point row: "∆ | name | coords"
    if (parts[0] === '∆') {
      if (!current) continue;
      const name = parts[1] ?? '?';
      let coord: { lat: number; lon: number } | null = null;
      for (const p of parts.slice(2)) {
        coord = coord ?? parseCoordPair(p);
      }
      if (!coord) continue; // skip points without published coordinates
      current.rawLegs[current.points.length] = pendingLeg.length > 0 ? pendingLeg : null;
      current.points.push({ name, lat: coord.lat, lon: coord.lon });
      pendingLeg = [];
      continue;
    }

    // Route name row: short row naming a tunnel/route, no coordinates.
    // Accent-tolerant: the source mixes "Túnel" and "Tunel".
    if (parts.length <= 2 && /T[úu]nel|Rota|Corredor/i.test(joined) && !parseCoordPair(joined)) {
      flush();
      current = {
        id: '', name: joined.replace(/\s+/g, ' ').trim(), area: areaFor(rm.index),
        points: [], rawLegs: [],
      };
      pendingLeg = [];
      continue;
    }

    // Leg value rows between points (courses / altitude limits)
    if (current && current.points.length > 0) {
      for (const p of parts) {
        if (/^(\d{3}|—|-|\d+\s*FT|FL\s*\d+)$/i.test(p)) pendingLeg.push(p);
      }
    }
  }
  flush();
  return routes;
}

// ---------- ENR 4.4 — significant points ----------

function parseEnr44(html: string): PtVfrPoint[] {
  const points: PtVfrPoint[] = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
  let rm: RegExpExecArray | null;
  while ((rm = rowRe.exec(html)) !== null) {
    const parts = rowParts(rm[1]!);
    if (parts.length < 3) continue;
    // Expected: name | lat | lon | route[, route...]
    const lat = parseLat(parts[1]!);
    const lon = parseLon(parts[2]!);
    if (lat == null || lon == null) continue;
    // Route names arrive as separate cells with a lone "," cell between them —
    // never split on commas (they occur inside route names too).
    const routes = parts
      .slice(3)
      .map((r) => r.replace(/\s+/g, ' ').trim())
      .filter((r) => r.length > 0 && r !== ',');
    points.push({ name: parts[0]!.replace(/\s+/g, ' ').trim(), lat, lon, routes });
  }
  return points;
}

// ---------- Main ----------

async function main(): Promise<void> {
  console.log('Fetching eVFR ENR 3.5 + ENR 4.4 from ais.nav.pt...');
  const [enr35Html, enr44Html] = await Promise.all([fetchPage(ENR_35_URL), fetchPage(ENR_44_URL)]);

  const routes = parseEnr35(enr35Html);
  const points = parseEnr44(enr44Html);
  const effectiveDate = extractEffectiveDate(enr35Html);

  if (routes.length < 5) throw new Error(`Suspiciously few routes parsed (${routes.length}) — eVFR layout may have changed`);
  if (points.length < 20) throw new Error(`Suspiciously few points parsed (${points.length}) — eVFR layout may have changed`);

  const dataset = {
    source: 'NAV Portugal — Manual VFR (eVFR), ENR 3.5 & ENR 4.4',
    sourceUrl: 'https://ais.nav.pt/',
    effectiveDate,
    generatedAt: new Date().toISOString().slice(0, 10),
    routes,
    points,
  };

  const outPath = join(dirname(fileURLToPath(import.meta.url)), '../src/pt-vfr/data/pt-vfr.json');
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(dataset, null, 2)}\n`);

  console.log(`OK: ${routes.length} routes, ${points.length} points, effective ${effectiveDate ?? '?'}`);
  for (const r of routes) {
    console.log(`  [${r.area}] ${r.name} — ${r.points.length} pts, ${r.legs.length} legs`);
  }
  console.log(`Wrote ${outPath}`);
}

void main();
