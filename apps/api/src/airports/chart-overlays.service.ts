import { createHash } from 'crypto';

import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { AerodromeChartOverlay } from '@prisma/client';
import sharp from 'sharp';

import { isTransientNetworkError, UpstreamUnavailableException } from '../common/exceptions/upstream-unavailable.exception';
import { PrismaService } from '../prisma/prisma.service';
import { R2StorageService } from '../r2/r2-storage.service';

import { getAiracCycle } from './charts.service';

// ---- Types ----

export interface ChartOverlayDto {
  id: string;
  icao: string;
  chartType: string;
  chartName: string;
  sourceUrl: string;
  sourceAuthority: string;
  imageContentType: string;
  imageWidth: number;
  imageHeight: number;
  bounds: { south: number; west: number; north: number; east: number };
  rotationDeg: number;
  opacityDefault: number;
  /** True when bounds are the runway-scaled approximation (no usable georef). */
  approximate: boolean;
  preparedAiracCycle: string;
  updatedAt: string;
}

export interface GetOrComputeArgs {
  icao: string;
  chartUrl: string;
  chartType: string;
  chartName: string;
  sourceAuthority: string;
  pageIndex?: number;
}

interface Bounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

interface RasterResult {
  buffer: Buffer;
  width: number;
  height: number;
}

// ---- Constants ----

const ALLOWED_HOSTS = new Set([
  'aisweb.decea.mil.br',
  'aisweb.decea.gov.br',
  'aeronav.faa.gov',
  'aip.enaire.es',
  'ais.nav.pt',
  'eaip.austrocontrol.at',
  'ais.fi',
  'www.ais.pansa.pl',
  'aro.lfv.se',
  'aim-prod.avinor.no',
]);

const FETCH_HEADERS = { 'User-Agent': 'Mozilla/5.0 (compatible; FSSuite/1.0)' };
const PDF_DOWNLOAD_TIMEOUT_MS = 60_000;
const RENDER_SCALE = 2; // PDF point -> image pixel multiplier

// ---- GeoPDF metadata parsing ----

interface GeoPdfMetadata {
  /** Geographic points [lat, lon, lat, lon, ...] in WGS-84 */
  gpts: number[];
  /** Logical points [x, y, x, y, ...] within the viewport (0-1 each, PDF y-up) */
  lpts: number[];
}

/**
 * Extract ISO 32000 /VP /Measure (GeoPDF) metadata from a PDF buffer for the
 * given page index. DECEA, FAA, and most modern aeronautical AIPs embed exact
 * geographic corners directly in the page object, so we can skip pixel
 * detection entirely.
 *
 * This is a focused regex extractor — it works when the page object dict is
 * not held inside a compressed object stream, which is the case for every
 * DECEA chart we've inspected. Returns null when the metadata isn't found.
 */
function parseGeoPdfPage(pdfBuffer: Buffer, pageIndex: number): GeoPdfMetadata | null {
  const text = pdfBuffer.toString('latin1');

  // Walk all top-level objects in document order; collect those that are pages.
  const objPattern = /\d+\s+\d+\s+obj([\s\S]*?)endobj/g;
  const pageBodies: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = objPattern.exec(text)) !== null) {
    const body = match[1] ?? '';
    if (/\/Type\s*\/Page(?!s)/.test(body)) pageBodies.push(body);
  }
  if (pageIndex < 0 || pageIndex >= pageBodies.length) return null;
  const pageBody = pageBodies[pageIndex] ?? '';

  // The page object holds a /VP[<<...>>] array. We want the first viewport
  // (DECEA charts only have one) and its /Measure subdict.
  const vpMatch = pageBody.match(/\/VP\s*\[\s*<<([\s\S]+?)>>\s*\]/);
  if (!vpMatch || !vpMatch[1]) return null;
  const vpBody = vpMatch[1];

  const gptsMatch = vpBody.match(/\/GPTS\s*\[([^\]]+)\]/);
  const lptsMatch = vpBody.match(/\/LPTS\s*\[([^\]]+)\]/);
  if (!gptsMatch || !gptsMatch[1] || !lptsMatch || !lptsMatch[1]) return null;

  const gpts = gptsMatch[1].trim().split(/\s+/).map(Number);
  const lpts = lptsMatch[1].trim().split(/\s+/).map(Number);
  if (gpts.some(Number.isNaN) || lpts.some(Number.isNaN)) return null;
  if (gpts.length !== lpts.length || gpts.length < 6 || gpts.length % 2 !== 0) return null;

  return { gpts, lpts };
}

// ---- Calibration ----

interface GeoCalibration {
  /** Crop window on the original raster — strips the chart's printed margins */
  crop: { left: number; top: number; width: number; height: number };
  /** Sharp rotation (clockwise positive, CCW negative) to bring chart to north-up */
  rotationDeg: number;
  /** Axis-aligned geographic bounding box for the rotated raster */
  bounds: Bounds;
}

/**
 * Compute the affine transform LPTS → GPTS from any 3 control points, then
 * derive: (a) the rotation needed to make the rasterized chart north-up,
 * (b) the LPTS-clipped crop region on the raster, and (c) the axis-aligned
 * geographic bounds for the rotated result.
 */
function computeGeoCalibration(
  geo: GeoPdfMetadata,
  rasterWidth: number,
  rasterHeight: number,
): GeoCalibration {
  const { lpts, gpts } = geo;

  // Solve  lat = a1·lx + a2·ly + a3  and  lon = b1·lx + b2·ly + b3  from
  // three (lpts, gpts) pairs.
  const lx1 = lpts[0]!, ly1 = lpts[1]!;
  const lx2 = lpts[2]!, ly2 = lpts[3]!;
  const lx3 = lpts[4]!, ly3 = lpts[5]!;
  const lat1 = gpts[0]!, lon1 = gpts[1]!;
  const lat2 = gpts[2]!, lon2 = gpts[3]!;
  const lat3 = gpts[4]!, lon3 = gpts[5]!;

  const det = (lx2 - lx1) * (ly3 - ly1) - (lx3 - lx1) * (ly2 - ly1);
  if (Math.abs(det) < 1e-9) {
    throw new Error('Degenerate LPTS control points — cannot solve affine transform');
  }
  // Only the dlat/dlon per dlx components are needed to compute the rotation
  // (image-right direction in geographic terms). The dly components a2/b2 are
  // determined by the same affine but not used here.
  const a1 = ((lat2 - lat1) * (ly3 - ly1) - (lat3 - lat1) * (ly2 - ly1)) / det;
  const b1 = ((lon2 - lon1) * (ly3 - ly1) - (lon3 - lon1) * (ly2 - ly1)) / det;

  // The raster's "image-right" direction (image dx=+1, dy=0):
  //   - corresponds to LPTS (dlx=+1/W, dly=0)
  //   - in geographic ENU it's (east=b1·cosLat, north=a1)
  // Bearing of image-right CW from north.
  const lats: number[] = [];
  const lons: number[] = [];
  for (let i = 0; i < gpts.length; i += 2) {
    lats.push(gpts[i]!);
    lons.push(gpts[i + 1]!);
  }
  const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const cosLat = Math.cos((midLat * Math.PI) / 180);
  const bearingRad = Math.atan2(b1 * cosLat, a1);
  const bearingDeg = (bearingRad * 180) / Math.PI;
  // Rotate so image-right ends up at bearing 90° (east); sharp uses CCW = negative.
  const rotationDeg = bearingDeg - 90;

  // Crop the raster to the LPTS data area (typically the central 80% of the page).
  const lxs: number[] = [];
  const lys: number[] = [];
  for (let i = 0; i < lpts.length; i += 2) {
    lxs.push(lpts[i]!);
    lys.push(lpts[i + 1]!);
  }
  const lptsMinX = Math.min(...lxs);
  const lptsMaxX = Math.max(...lxs);
  const lptsMinY = Math.min(...lys);
  const lptsMaxY = Math.max(...lys);

  // PDF y is up; rasterized image y is down — flip when converting LPTS y.
  const cropLeft = clamp(Math.round(lptsMinX * rasterWidth), 0, rasterWidth);
  const cropRight = clamp(Math.round(lptsMaxX * rasterWidth), 0, rasterWidth);
  const cropTop = clamp(Math.round((1 - lptsMaxY) * rasterHeight), 0, rasterHeight);
  const cropBottom = clamp(Math.round((1 - lptsMinY) * rasterHeight), 0, rasterHeight);

  const bounds: Bounds = {
    south: Math.min(...lats),
    north: Math.max(...lats),
    west: Math.min(...lons),
    east: Math.max(...lons),
  };

  return {
    crop: {
      left: cropLeft,
      top: cropTop,
      width: Math.max(1, cropRight - cropLeft),
      height: Math.max(1, cropBottom - cropTop),
    },
    rotationDeg,
    bounds,
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Axis-aligned geographic bounds of a page's GPTS control points. */
export function gptsBounds(geo: GeoPdfMetadata): Bounds {
  const lats: number[] = [];
  const lons: number[] = [];
  for (let i = 0; i < geo.gpts.length; i += 2) {
    lats.push(geo.gpts[i]!);
    lons.push(geo.gpts[i + 1]!);
  }
  return {
    south: Math.min(...lats),
    north: Math.max(...lats),
    west: Math.min(...lons),
    east: Math.max(...lons),
  };
}

export function boundsContain(b: Bounds, lat: number, lon: number): boolean {
  return lat >= b.south && lat <= b.north && lon >= b.west && lon <= b.east;
}

/** True when two LPTS arrays match within a small tolerance. */
export function lptsEqual(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((v, i) => Math.abs(v - b[i]!) < 1e-4);
}

/** Count `/Type /Page` objects (same page detection parseGeoPdfPage uses). */
function countPdfPageObjects(pdfBuffer: Buffer): number {
  const text = pdfBuffer.toString('latin1');
  const objPattern = /\d+\s+\d+\s+obj([\s\S]*?)endobj/g;
  let count = 0;
  let m: RegExpExecArray | null;
  while ((m = objPattern.exec(text)) !== null) {
    if (/\/Type\s*\/Page(?!s)/.test(m[1] ?? '')) count++;
  }
  return count;
}

/**
 * When the page we render (the VAC graphic) has a wrong/missing georeference,
 * borrow a CORRECT one from a sibling page of the same PDF — but only if that
 * sibling's georef (a) actually covers the ARP and (b) shares the render
 * page's LPTS (same viewport geometry → same chart frame). DECEA ships some
 * charts whose graphic-page GPTS are offset by a constant while another page
 * carries the right corners for the identical frame (SBJD: page 0 graphic is
 * +0.27° lat off; page 1 has the correct GPTS, same LPTS/span). Calibrated
 * against the render page's raster dimensions. Returns null if no such page.
 */
function findSiblingGeoref(
  pdfBuffer: Buffer,
  renderPageIndex: number,
  renderLpts: number[],
  arpLat: number,
  arpLon: number,
  rasterWidth: number,
  rasterHeight: number,
): GeoCalibration | null {
  const count = countPdfPageObjects(pdfBuffer);
  for (let p = 0; p < count; p++) {
    if (p === renderPageIndex) continue;
    const geo = parseGeoPdfPage(pdfBuffer, p);
    if (!geo) continue;
    if (!boundsContain(gptsBounds(geo), arpLat, arpLon)) continue;
    if (!lptsEqual(geo.lpts, renderLpts)) continue;
    return computeGeoCalibration(geo, rasterWidth, rasterHeight);
  }
  return null;
}

/**
 * Runway-scaled square box centred on the ARP — the last-resort fallback when
 * NO page of the chart carries a georeference that covers the field. North-up
 * (DECEA VAC charts publish north-up). Approximate by design; the overlay is
 * flagged `approximate` so the UI can say so, and the opacity slider lets the
 * pilot judge the fit (see docs/aerodrome-chart-overlay.md).
 */
export function heuristicBounds(lat: number, lon: number, longestRunwayFt: number | null): Bounds {
  const FT_PER_NM = 6076.12;
  const longestNm = (longestRunwayFt ?? 0) / FT_PER_NM;
  const sideNm = Math.max(longestNm * 4, 3); // empirical scale factor
  const halfNm = sideNm / 2;
  const latDelta = halfNm / 60;
  const lonDelta = halfNm / (60 * Math.cos((lat * Math.PI) / 180));
  return {
    south: lat - latDelta,
    north: lat + latDelta,
    west: lon - lonDelta,
    east: lon + lonDelta,
  };
}

// ---- PDF rasterization ----

async function rasterizePdfPage(pdfBuffer: Buffer, pageIndex: number): Promise<RasterResult> {
  // Dynamic imports keep these heavy modules out of the cold-start path of
  // requests that don't render charts.
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const { createCanvas } = await import('@napi-rs/canvas');

  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(pdfBuffer),
    isEvalSupported: false,
    useSystemFonts: true,
  });
  const pdf = await loadingTask.promise;

  try {
    if (pageIndex < 0 || pageIndex >= pdf.numPages) {
      throw new Error(`page ${pageIndex} out of range (PDF has ${pdf.numPages} pages)`);
    }
    const page = await pdf.getPage(pageIndex + 1);
    const viewport = page.getViewport({ scale: RENDER_SCALE });
    const width = Math.ceil(viewport.width);
    const height = Math.ceil(viewport.height);

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    await page.render({
      canvasContext: ctx as unknown as CanvasRenderingContext2D,
      viewport,
    }).promise;

    return { buffer: canvas.toBuffer('image/png'), width, height };
  } finally {
    await pdf.cleanup();
    await pdf.destroy().catch(() => {});
  }
}

async function cropAndRotate(
  pngBuffer: Buffer,
  crop: { left: number; top: number; width: number; height: number },
  rotationDeg: number,
): Promise<RasterResult> {
  const { data, info } = await sharp(pngBuffer)
    .extract(crop)
    .rotate(rotationDeg, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer({ resolveWithObject: true });
  return { buffer: data, width: info.width, height: info.height };
}

// ---- Service ----

@Injectable()
export class ChartOverlaysService {
  private readonly logger = new Logger(ChartOverlaysService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly r2: R2StorageService,
  ) {}

  async getOrCompute(args: GetOrComputeArgs): Promise<ChartOverlayDto> {
    const normalizedIcao = args.icao.toUpperCase().trim();
    const { cycle } = getAiracCycle();

    this.validateChartUrl(args.chartUrl);

    // Cache hit: row exists for this URL in the current cycle and image is in R2.
    const cached = await this.prisma.aerodromeChartOverlay.findUnique({
      where: { sourceUrl_preparedAiracCycle: { sourceUrl: args.chartUrl, preparedAiracCycle: cycle } },
    });
    if (cached) {
      const obj = await this.r2.getObject(cached.imageKey);
      if (obj) return this.toDto(cached);
      this.logger.warn(`cache row ${cached.id} present but image ${cached.imageKey} missing — rebuilding`);
    }

    // Verify the aerodrome exists so we surface a meaningful error before
    // doing expensive work.
    const airport = await this.prisma.airport.findUnique({ where: { icao: normalizedIcao } });
    if (!airport) throw new NotFoundException(`Aerodrome ${normalizedIcao} not found`);

    const pdfBuffer = await this.downloadPdf(args.chartUrl);

    // DECEA convention: the VAC graphic is the front page (index 0); the
    // reverse side is the textual/procedures page. Honour an explicit ?page=.
    const pageIndex = args.pageIndex ?? 0;
    const geo = parseGeoPdfPage(pdfBuffer, pageIndex);
    const original = await rasterizePdfPage(pdfBuffer, pageIndex);
    const calibration = geo ? computeGeoCalibration(geo, original.width, original.height) : null;

    // Trust the embedded GeoPDF georeference only when its bounds actually
    // cover the aerodrome. Some DECEA charts ship a wrong georeference (SBJD's
    // VAC GPTS sit ~16 NM south, leaving the field outside the frame) — in
    // that case, and when there's no GeoPDF at all, fall back to the
    // runway-scaled heuristic centred on the ARP (docs/aerodrome-chart-overlay).
    let bounds: Bounds;
    let crop: GeoCalibration['crop'];
    let rotationDeg: number;
    let georef: 'geopdf' | 'geopdf-sibling' | 'heuristic';
    let approximate: boolean;
    if (calibration && boundsContain(calibration.bounds, airport.latitude, airport.longitude)) {
      // The graphic page's own georeference covers the field — exact placement.
      bounds = calibration.bounds;
      crop = calibration.crop;
      rotationDeg = calibration.rotationDeg;
      georef = 'geopdf';
      approximate = false;
    } else {
      // The graphic page's georef is wrong/missing. Borrow a correct one from a
      // sibling page of the same frame (real control points, exact placement).
      const sibling = geo
        ? findSiblingGeoref(pdfBuffer, pageIndex, geo.lpts, airport.latitude, airport.longitude, original.width, original.height)
        : null;
      if (sibling) {
        bounds = sibling.bounds;
        crop = sibling.crop;
        rotationDeg = sibling.rotationDeg;
        georef = 'geopdf-sibling';
        approximate = false;
        this.logger.warn(`${normalizedIcao} graphic-page georef is off — using a sibling page's valid georef`);
      } else {
        // No page carries a georeference that covers the field. Plot the
        // runway-scaled box centred on the ARP, flagged approximate.
        const longest = await this.prisma.runway.findFirst({
          where: { airportIcao: normalizedIcao },
          orderBy: { lengthFt: 'desc' },
          select: { lengthFt: true },
        });
        bounds = heuristicBounds(airport.latitude, airport.longitude, longest?.lengthFt ?? null);
        crop = calibration?.crop ?? { left: 0, top: 0, width: original.width, height: original.height };
        rotationDeg = 0;
        georef = 'heuristic';
        approximate = true;
        this.logger.warn(`${normalizedIcao} chart has no usable georef — approximate runway-box placement`);
      }
    }

    const rotated = await cropAndRotate(original.buffer, crop, rotationDeg);

    const imageKey = this.r2KeyFor(normalizedIcao, args.chartUrl, cycle);
    await this.r2.putObject(imageKey, rotated.buffer, 'image/png');

    const row = await this.prisma.aerodromeChartOverlay.upsert({
      where: { sourceUrl_preparedAiracCycle: { sourceUrl: args.chartUrl, preparedAiracCycle: cycle } },
      update: {
        icao: normalizedIcao,
        chartType: args.chartType,
        chartName: args.chartName,
        sourceAuthority: args.sourceAuthority,
        pageIndex,
        imageKey,
        imageContentType: 'image/png',
        imageWidth: rotated.width,
        imageHeight: rotated.height,
        boundsSouth: bounds.south,
        boundsWest: bounds.west,
        boundsNorth: bounds.north,
        boundsEast: bounds.east,
        rotationDeg: 0,
        opacityDefault: 0.7,
        approximate,
      },
      create: {
        icao: normalizedIcao,
        chartType: args.chartType,
        chartName: args.chartName,
        sourceUrl: args.chartUrl,
        sourceAuthority: args.sourceAuthority,
        pageIndex,
        imageKey,
        imageContentType: 'image/png',
        imageWidth: rotated.width,
        imageHeight: rotated.height,
        boundsSouth: bounds.south,
        boundsWest: bounds.west,
        boundsNorth: bounds.north,
        boundsEast: bounds.east,
        rotationDeg: 0,
        opacityDefault: 0.7,
        approximate,
        preparedAiracCycle: cycle,
      },
    });

    this.logger.log(
      `prepared overlay ${row.id} for ${normalizedIcao} ${args.chartType} ` +
      `(georef=${georef}, rotation=${rotationDeg.toFixed(1)}°, crop=${crop.width}×${crop.height}, ` +
      `final=${rotated.width}×${rotated.height}, ${(rotated.buffer.length / 1024).toFixed(0)} KB)`,
    );

    return this.toDto(row);
  }

  async findByIdOrThrow(id: string): Promise<AerodromeChartOverlay> {
    const overlay = await this.prisma.aerodromeChartOverlay.findUnique({ where: { id } });
    if (!overlay) throw new NotFoundException(`Chart overlay ${id} not found`);
    return overlay;
  }

  // ---- Helpers ----

  private validateChartUrl(raw: string): void {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new BadRequestException('Invalid chart URL');
    }
    if (!url.protocol.startsWith('https') || !ALLOWED_HOSTS.has(url.hostname)) {
      throw new BadRequestException('Chart URL domain not allowed');
    }
  }

  private r2KeyFor(icao: string, chartUrl: string, cycle: string): string {
    const hash = createHash('sha1').update(chartUrl).digest('hex').slice(0, 12);
    return `chart-overlays/${cycle}/${icao}/${hash}.png`;
  }

  private async downloadPdf(url: string): Promise<Buffer> {
    let resp: Response;
    try {
      resp = await fetch(url, {
        headers: FETCH_HEADERS,
        redirect: 'follow',
        signal: AbortSignal.timeout(PDF_DOWNLOAD_TIMEOUT_MS),
      });
    } catch (err) {
      if (isTransientNetworkError(err)) {
        const host = ((): string => { try { return new URL(url).hostname; } catch { return 'upstream'; } })();
        throw new UpstreamUnavailableException(host, err);
      }
      throw err;
    }
    if (!resp.ok) {
      throw new BadRequestException(`Chart PDF download failed: HTTP ${resp.status}`);
    }
    const ab = await resp.arrayBuffer();
    return Buffer.from(ab);
  }

  private toDto(r: AerodromeChartOverlay): ChartOverlayDto {
    return {
      id: r.id,
      icao: r.icao,
      chartType: r.chartType,
      chartName: r.chartName,
      sourceUrl: r.sourceUrl,
      sourceAuthority: r.sourceAuthority,
      imageContentType: r.imageContentType,
      imageWidth: r.imageWidth,
      imageHeight: r.imageHeight,
      bounds: {
        south: r.boundsSouth,
        west: r.boundsWest,
        north: r.boundsNorth,
        east: r.boundsEast,
      },
      rotationDeg: r.rotationDeg,
      opacityDefault: r.opacityDefault,
      approximate: r.approximate,
      preparedAiracCycle: r.preparedAiracCycle,
      updatedAt: r.updatedAt.toISOString(),
    };
  }
}
