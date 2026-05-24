import { createHash } from 'crypto';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';

import { BadRequestException, Controller, Get, Logger, NotFoundException, Param, Query, Res, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import { JwtAuthGuard, Public } from '../common/guards/jwt-auth.guard';
import { R2StorageService } from '../r2/r2-storage.service';

import { AirportsService } from './airports.service';
import { ChartOverlaysService } from './chart-overlays.service';
import { ChartsService, getAiracCycle } from './charts.service';

@ApiTags('aerodromes')
@Controller('aerodromes')
@UseGuards(JwtAuthGuard)
export class AirportsController {
  private readonly logger = new Logger(AirportsController.name);

  constructor(
    private readonly airportsService: AirportsService,
    private readonly chartsService: ChartsService,
    private readonly chartOverlaysService: ChartOverlaysService,
    private readonly r2: R2StorageService,
  ) {}

  @Get('search')
  @ApiOperation({ summary: 'Search aerodromes by ICAO code or name' })
  @ApiQuery({ name: 'q', required: true, description: 'Search query (min 2 chars)' })
  async search(@Query('q') query: string): Promise<unknown> {
    if (!query || query.trim().length < 2) {
      return [];
    }
    return this.airportsService.search(query);
  }

  @Get('map')
  @ApiOperation({ summary: 'Get aerodromes within a bounding box for map display' })
  @ApiQuery({ name: 'south', required: true })
  @ApiQuery({ name: 'west', required: true })
  @ApiQuery({ name: 'north', required: true })
  @ApiQuery({ name: 'east', required: true })
  @ApiQuery({ name: 'types', required: false, description: 'Comma-separated airport types filter' })
  async map(
    @Query('south') south: string,
    @Query('west') west: string,
    @Query('north') north: string,
    @Query('east') east: string,
    @Query('types') types?: string,
  ): Promise<unknown> {
    const bounds = {
      south: parseFloat(south),
      west: parseFloat(west),
      north: parseFloat(north),
      east: parseFloat(east),
    };

    if (isNaN(bounds.south) || isNaN(bounds.west) || isNaN(bounds.north) || isNaN(bounds.east)) {
      return [];
    }

    const typeFilter = types ? types.split(',').map((t) => t.trim()) : undefined;
    return this.airportsService.findByBbox(bounds, typeFilter);
  }

  @Public()
  @Get('chart-proxy')
  @ApiOperation({ summary: 'Proxy a chart PDF to allow inline display (strips Content-Disposition: attachment)' })
  @ApiQuery({ name: 'url', required: true })
  async chartProxy(@Query('url') url: string, @Res() res: Response): Promise<void> {
    try { return await this._chartProxy(url, res); } catch (err) {
      this.logger.error(`chart-proxy error: ${(err as Error).stack ?? err}`);
      if (!res.headersSent) res.status(502).json({ error: (err as Error).message });
    }
  }

  private async _chartProxy(url: string, res: Response): Promise<void> {
    const ALLOWED_HOSTS = [
      'aisweb.decea.mil.br',
      'aeronav.faa.gov',
      'aip.enaire.es',
      'www.sia.aviation-civile.gouv.fr',
      'eaip.lvnl.nl',
      'aim-india.aai.aero',
      'ais.nav.pt',
      'eaip.austrocontrol.at',
      'ais.fi',
      'www.ais.pansa.pl',
      'aro.lfv.se',
      'aim-prod.avinor.no',
    ];

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      throw new BadRequestException('Invalid chart URL');
    }

    if (!parsedUrl.protocol.startsWith('https') || !ALLOWED_HOSTS.includes(parsedUrl.hostname)) {
      throw new BadRequestException('Chart URL domain not allowed');
    }

    const { cycle } = getAiracCycle();
    const urlHash = createHash('sha256').update(url).digest('hex');
    const r2Key = `charts/${cycle}/${urlHash}.pdf`;

    // Try R2 cache first
    const cached = await this.r2.getObject(r2Key);
    if (cached) {
      this.setPdfHeaders(res);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      if (cached.contentLength) res.setHeader('Content-Length', cached.contentLength);
      try {
        await pipeline(cached.body, res);
      } catch {
        if (!res.headersSent) res.status(502).end();
        else res.end();
      }
      return;
    }

    // Cache miss — fetch upstream
    const upstream = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FSSuite/1.0)' },
      redirect: 'follow',
      signal: AbortSignal.timeout(120_000),
    });

    if (!upstream.ok || !upstream.body) {
      res.status(upstream.status).end();
      return;
    }

    const contentType = upstream.headers.get('content-type') ?? '';
    const isPdf = contentType.includes('pdf') || contentType.includes('octet-stream');
    const upstreamLength = parseInt(upstream.headers.get('content-length') ?? '0', 10);
    const MAX_CACHE_SIZE = 10 * 1024 * 1024; // 10 MB
    const shouldCache = this.r2.isEnabled() && isPdf && upstreamLength < MAX_CACHE_SIZE;

    if (shouldCache) {
      const chunks: Buffer[] = [];
      const nodeStream = Readable.fromWeb(upstream.body as never);
      for await (const chunk of nodeStream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
      }
      const buffer = Buffer.concat(chunks);

      if (buffer.length > 0) {
        this.setPdfHeaders(res);
        res.setHeader('Cache-Control', 'public, no-cache');
        res.setHeader('Content-Length', buffer.length);
        res.send(buffer);

        this.r2.putObject(r2Key, buffer, 'application/pdf').catch((err) => {
          this.logger.warn(`R2 background PUT failed: ${err}`);
        });
        return;
      }
    }

    // Buffer and send directly (R2 disabled, non-PDF, or too large)
    const chunks: Buffer[] = [];
    const nodeStream = Readable.fromWeb(upstream.body as never);
    for await (const chunk of nodeStream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
    }
    const buffer = Buffer.concat(chunks);

    this.setPdfHeaders(res);
    const etag = upstream.headers.get('etag');
    const lastMod = upstream.headers.get('last-modified');
    if (etag) res.setHeader('ETag', etag);
    if (lastMod) res.setHeader('Last-Modified', lastMod);
    res.setHeader('Cache-Control', 'public, no-cache');
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  }

  private setPdfHeaders(res: Response): void {
    res.removeHeader('X-Frame-Options');
    res.removeHeader('Content-Security-Policy');
    res.removeHeader('Cross-Origin-Resource-Policy');
    res.removeHeader('Cross-Origin-Opener-Policy');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  }

  @Public()
  @Get('wms-proxy')
  @ApiOperation({ summary: 'Proxy WMS GetFeatureInfo requests to DECEA GeoServer (bypasses CORS)' })
  @ApiQuery({ name: 'url', required: true })
  async wmsProxy(@Query('url') url: string, @Res() res: Response): Promise<void> {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      throw new BadRequestException('Invalid URL');
    }

    if (!['geoaisweb.decea.mil.br'].includes(parsedUrl.hostname)) {
      throw new BadRequestException('Only DECEA GeoServer URLs are allowed');
    }

    const upstream = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FSSuite/1.0)' },
      signal: AbortSignal.timeout(10_000),
    });

    if (!upstream.ok) {
      res.status(upstream.status).end();
      return;
    }

    const contentType = upstream.headers.get('content-type') ?? 'application/json';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=60');

    const body = await upstream.text();
    res.send(body);
  }

  @Public()
  @Get('chart-overlays/:id/image')
  @ApiOperation({ summary: 'Stream a prepared chart overlay raster image from R2' })
  async chartOverlayImage(@Param('id') id: string, @Res() res: Response): Promise<void> {
    const overlay = await this.chartOverlaysService.findByIdOrThrow(id);
    const obj = await this.r2.getObject(overlay.imageKey);
    if (!obj) throw new NotFoundException('Chart overlay image not available');

    res.setHeader('Content-Type', overlay.imageContentType);
    res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.removeHeader('X-Frame-Options');
    if (obj.contentLength) res.setHeader('Content-Length', obj.contentLength);

    try {
      await pipeline(obj.body, res);
    } catch (err) {
      this.logger.warn(`chart-overlay image stream failed for ${id}: ${(err as Error).message}`);
      if (!res.headersSent) res.status(502).end();
      else res.end();
    }
  }

  @Public()
  @Get(':icao/charts')
  @ApiOperation({ summary: 'Search for aerodrome charts from multiple authorities' })
  async charts(@Param('icao') icao: string): Promise<unknown> {
    return this.chartsService.searchCharts(icao);
  }

  @Public()
  @Get(':icao/chart-overlay')
  @ApiOperation({
    summary: 'Compute (or fetch from cache) a georeferenced map overlay for an aerodrome chart',
  })
  @ApiQuery({ name: 'url', required: true, description: 'Direct PDF URL of the chart' })
  @ApiQuery({ name: 'type', required: true, description: 'Chart type (e.g. VAC)' })
  @ApiQuery({ name: 'name', required: true, description: 'Chart display name' })
  @ApiQuery({ name: 'authority', required: false, description: 'Source authority' })
  @ApiQuery({ name: 'page', required: false, description: 'PDF page index (default 0)' })
  async chartOverlay(
    @Param('icao') icao: string,
    @Query('url') url: string,
    @Query('type') type: string,
    @Query('name') name: string,
    @Query('authority') authority?: string,
    @Query('page') page?: string,
  ): Promise<unknown> {
    if (!url || !type || !name) {
      throw new BadRequestException('url, type, and name are required');
    }
    const pageIndex = page ? parseInt(page, 10) : 0;
    if (Number.isNaN(pageIndex) || pageIndex < 0) {
      throw new BadRequestException('page must be a non-negative integer');
    }
    return this.chartOverlaysService.getOrCompute({
      icao,
      chartUrl: url,
      chartType: type,
      chartName: name,
      sourceAuthority: authority ?? 'unknown',
      pageIndex,
    });
  }

  @Public()
  @Get(':icao')
  @ApiOperation({ summary: 'Get aerodrome details by ICAO code, including runways' })
  async findOne(@Param('icao') icao: string): Promise<unknown> {
    const airport = await this.airportsService.findByIcao(icao);
    if (!airport) {
      throw new NotFoundException(`Aerodrome ${icao.toUpperCase()} not found`);
    }
    return airport;
  }
}
