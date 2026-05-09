import { BadRequestException, Controller, Get, NotFoundException, Param, Query, Res, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';

import { JwtAuthGuard, Public } from '../common/guards/jwt-auth.guard';

import { AirportsService } from './airports.service';
import { ChartsService } from './charts.service';

@ApiTags('aerodromes')
@Controller('aerodromes')
@UseGuards(JwtAuthGuard)
export class AirportsController {
  constructor(
    private readonly airportsService: AirportsService,
    private readonly chartsService: ChartsService,
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
    // Whitelist of allowed chart PDF domains
    const ALLOWED_HOSTS = [
      'aisweb.decea.gov.br',      // Brazil — DECEA AISWEB
      'aisweb.decea.mil.br',      // Brazil — DECEA AISWEB (mil.br domain)
      'aeronav.faa.gov',           // USA — FAA DTPP
      'aip.enaire.es',             // Spain — ENAIRE
      'www.sia.aviation-civile.gouv.fr', // France — SIA
      'eaip.lvnl.nl',             // Netherlands — LVNL
      'aim-india.aai.aero',       // India — AAI
      'ais.nav.pt',               // Portugal — NAV Portugal
      'eaip.austrocontrol.at',    // Austria — Austrocontrol
      'ais.fi',                    // Finland — ANS Finland
      'www.ais.pansa.pl',         // Poland — PANSA
      'aro.lfv.se',               // Sweden — LFV
      'aim-prod.avinor.no',       // Norway — Avinor
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

    const upstream = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FSSuite/1.0)' },
      redirect: 'follow',
      signal: AbortSignal.timeout(120_000),
    });

    if (!upstream.ok || !upstream.body) {
      res.status(upstream.status).end();
      return;
    }

    res.removeHeader('X-Frame-Options');
    res.removeHeader('Content-Security-Policy');
    res.removeHeader('Cross-Origin-Resource-Policy');
    res.removeHeader('Cross-Origin-Opener-Policy');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

    const etag = upstream.headers.get('etag');
    const lastMod = upstream.headers.get('last-modified');
    if (etag) res.setHeader('ETag', etag);
    if (lastMod) res.setHeader('Last-Modified', lastMod);
    res.setHeader('Cache-Control', 'public, no-cache');

    const contentLength = upstream.headers.get('content-length');
    if (contentLength) {
      res.setHeader('Content-Length', contentLength);
    }

    const nodeStream = Readable.fromWeb(upstream.body as never);
    try {
      await pipeline(nodeStream, res);
    } catch {
      if (!res.headersSent) {
        res.status(502).end();
      } else {
        res.end();
      }
    }
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

    if (!['geoaisweb.decea.mil.br', 'geoaisweb.decea.gov.br'].includes(parsedUrl.hostname)) {
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
  @Get(':icao/charts')
  @ApiOperation({ summary: 'Search for aerodrome charts from multiple authorities' })
  async charts(@Param('icao') icao: string): Promise<unknown> {
    return this.chartsService.searchCharts(icao);
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
