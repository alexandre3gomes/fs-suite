import { createHash } from 'crypto';

import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { AerodromeChartOverlay } from '@prisma/client';
import sharp from 'sharp';

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
    const pageIndex = args.pageIndex ?? 0;

    const geo = parseGeoPdfPage(pdfBuffer, pageIndex);
    if (!geo) {
      throw new BadRequestException(
        'Chart PDF has no embedded geographic metadata (GeoPDF); cannot project on map.',
      );
    }

    const original = await rasterizePdfPage(pdfBuffer, pageIndex);
    const calibration = computeGeoCalibration(geo, original.width, original.height);
    const rotated = await cropAndRotate(original.buffer, calibration.crop, calibration.rotationDeg);

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
        boundsSouth: calibration.bounds.south,
        boundsWest: calibration.bounds.west,
        boundsNorth: calibration.bounds.north,
        boundsEast: calibration.bounds.east,
        rotationDeg: 0,
        opacityDefault: 0.7,
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
        boundsSouth: calibration.bounds.south,
        boundsWest: calibration.bounds.west,
        boundsNorth: calibration.bounds.north,
        boundsEast: calibration.bounds.east,
        rotationDeg: 0,
        opacityDefault: 0.7,
        preparedAiracCycle: cycle,
      },
    });

    this.logger.log(
      `prepared overlay ${row.id} for ${normalizedIcao} ${args.chartType} ` +
      `(GeoPDF: rotation=${calibration.rotationDeg.toFixed(1)}°, crop=${calibration.crop.width}×${calibration.crop.height}, ` +
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
    const resp = await fetch(url, {
      headers: FETCH_HEADERS,
      redirect: 'follow',
      signal: AbortSignal.timeout(PDF_DOWNLOAD_TIMEOUT_MS),
    });
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
      preparedAiracCycle: r.preparedAiracCycle,
      updatedAt: r.updatedAt.toISOString(),
    };
  }
}
