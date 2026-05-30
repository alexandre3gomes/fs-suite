import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

import {
  type RouteAltitudesResponse,
  type RouteOptionsResponse,
  type SuggestRouteResponse,
  type ValidateRouteResponse,
  ReaNavigationService,
} from './rea-navigation.service';
import { type ReaDetectionResult, type ReaRegionData, ReaService } from './rea.service';

@ApiTags('rea')
@Controller('rea')
@UseGuards(JwtAuthGuard)
export class ReaController {
  constructor(
    private readonly rea: ReaService,
    private readonly reaNav: ReaNavigationService,
  ) {}

  @Get('regions')
  @ApiOperation({ summary: 'List all REA regions with chart PDF URLs' })
  async listRegions(): Promise<{ regionId: string; chartName: string; chartPdfUrl: string }[]> {
    return this.rea.listRegions();
  }

  @Get('region/:regionId')
  @ApiOperation({ summary: 'Get all REA corridor data for a specific region' })
  async getRegion(@Param('regionId') regionId: string): Promise<ReaRegionData | { error: string; regionId: string }> {
    const data = await this.rea.getRegionData(regionId);
    if (!data) return { error: 'Region not found', regionId };
    return data;
  }

  @Get('detect')
  @ApiOperation({ summary: 'Detect REA corridors crossed by a route' })
  @ApiQuery({ name: 'waypoints', description: 'Comma-separated lat:lon pairs (e.g. -23.5:-46.6,-22.9:-43.1)', required: true })
  async detect(@Query('waypoints') waypointsStr: string): Promise<ReaDetectionResult> {
    const waypoints = this.parseWaypoints(waypointsStr);
    if (waypoints.length < 2) {
      return { regions: [] };
    }
    return this.rea.detectReaForRoute(waypoints);
  }

  @Get('navigate/suggest')
  @ApiOperation({ summary: 'Suggest optimal REA route between two points using directed graph' })
  @ApiQuery({ name: 'origin', description: 'Origin lat:lon', required: true })
  @ApiQuery({ name: 'destination', description: 'Destination lat:lon', required: true })
  @ApiQuery({ name: 'altitude', description: 'Planned altitude in feet', required: false })
  @ApiQuery({ name: 'preferCorridor', description: 'Pilot preference — bias the path toward this corridor name (soft, 0.1× weight)', required: false })
  async suggestRoute(
    @Query('origin') origin: string,
    @Query('destination') destination: string,
    @Query('altitude') altitude?: string,
    @Query('preferCorridor') preferCorridor?: string,
  ): Promise<SuggestRouteResponse> {
    const [oLat, oLon] = origin.split(':').map(Number);
    const [dLat, dLon] = destination.split(':').map(Number);
    if ([oLat, oLon, dLat, dLon].some((v) => v == null || isNaN(v!))) {
      return { found: false, legs: [], waypoints: [], totalDistanceNm: 0, corridorNames: [], altitudeRange: null, compulsoryAltitude: null };
    }
    return this.reaNav.suggestRoute(
      { lat: oLat!, lon: oLon! },
      { lat: dLat!, lon: dLon! },
      altitude ? Number(altitude) : undefined,
      preferCorridor,
    );
  }

  @Get('navigate/options')
  @ApiOperation({ summary: 'Enumerate distinct (entry gate → exit gate) route options for O→D' })
  @ApiQuery({ name: 'origin', description: 'Origin lat:lon', required: true })
  @ApiQuery({ name: 'destination', description: 'Destination lat:lon', required: true })
  @ApiQuery({ name: 'altitude', description: 'Planned altitude in feet', required: false })
  async routeOptions(
    @Query('origin') origin: string,
    @Query('destination') destination: string,
    @Query('altitude') altitude?: string,
  ): Promise<RouteOptionsResponse> {
    const [oLat, oLon] = origin.split(':').map(Number);
    const [dLat, dLon] = destination.split(':').map(Number);
    if ([oLat, oLon, dLat, dLon].some((v) => v == null || isNaN(v!))) {
      return { options: [] };
    }
    return this.reaNav.listRouteOptions(
      { lat: oLat!, lon: oLon! },
      { lat: dLat!, lon: dLon! },
      altitude ? Number(altitude) : undefined,
    );
  }

  @Get('navigate/validate')
  @ApiOperation({ summary: 'Validate a route against REA corridor direction and altitude rules' })
  @ApiQuery({ name: 'waypoints', description: 'Comma-separated lat:lon pairs', required: true })
  @ApiQuery({ name: 'altitude', description: 'Planned altitude in feet', required: false })
  async validateRoute(
    @Query('waypoints') waypointsStr: string,
    @Query('altitude') altitude?: string,
  ): Promise<ValidateRouteResponse> {
    const waypoints = this.parseWaypoints(waypointsStr);
    return this.reaNav.validateRoute(waypoints, altitude ? Number(altitude) : undefined);
  }

  @Get('navigate/altitudes')
  @ApiOperation({ summary: 'Get per-leg REA altitude constraints (altComp/altMin/altMax)' })
  @ApiQuery({ name: 'waypoints', description: 'Comma-separated lat:lon pairs', required: true })
  async routeAltitudes(@Query('waypoints') waypointsStr: string): Promise<RouteAltitudesResponse> {
    const waypoints = this.parseWaypoints(waypointsStr);
    return this.reaNav.getRouteAltitudes(waypoints);
  }

  private parseWaypoints(str: string): { lat: number; lon: number }[] {
    if (!str) return [];
    return str.split(',').map((pair) => {
      const [lat, lon] = pair.split(':').map(Number);
      if (lat == null || lon == null || isNaN(lat) || isNaN(lon)) return null;
      return { lat, lon };
    }).filter((w): w is { lat: number; lon: number } => w !== null);
  }
}
