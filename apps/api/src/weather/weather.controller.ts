import type { CrosswindAnalysis, ParsedMetar, ParsedTaf, SigmetCollection } from '@fs-suite/types';
import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

import type { FlightCategoryResult, RouteSafetyResponse } from './weather.service';
import { WeatherService } from './weather.service';

@ApiTags('weather')
@Controller('weather')
@UseGuards(JwtAuthGuard)
export class WeatherController {
  constructor(private readonly weatherService: WeatherService) {}

  @Get('flight-categories')
  @ApiOperation({ summary: 'Get flight categories (VFR/MVFR/IFR/LIFR) for map display' })
  @ApiQuery({
    name: 'icaos',
    required: true,
    description: 'Comma-separated ICAO codes (max 50)',
    example: 'SBSP,SBGR,SBKP',
  })
  async getFlightCategories(
    @Query('icaos') icaos: string,
  ): Promise<FlightCategoryResult[]> {
    if (!icaos || icaos.trim().length === 0) return [];

    const codes = icaos
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean)
      .slice(0, 50);

    return this.weatherService.getFlightCategories(codes);
  }

  @Get('metar')
  @ApiOperation({ summary: 'Get METAR for one or more ICAO codes' })
  @ApiQuery({
    name: 'icaos',
    required: true,
    description: 'Comma-separated ICAO codes (max 50)',
    example: 'SBSP,SBGR,SBKP',
  })
  async getMetars(@Query('icaos') icaos: string): Promise<ParsedMetar[]> {
    if (!icaos || icaos.trim().length === 0) {
      return [];
    }

    const codes = icaos
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean)
      .slice(0, 50);

    return this.weatherService.getMetars(codes);
  }

  @Get('taf')
  @ApiOperation({ summary: 'Get TAF for one or more ICAO codes' })
  @ApiQuery({
    name: 'icaos',
    required: true,
    description: 'Comma-separated ICAO codes (max 50)',
    example: 'SBSP,SBGR,SBKP',
  })
  async getTafs(@Query('icaos') icaos: string): Promise<ParsedTaf[]> {
    if (!icaos || icaos.trim().length === 0) {
      return [];
    }

    const codes = icaos
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean)
      .slice(0, 50);

    return this.weatherService.getTafs(codes);
  }

  @Get('sigmets')
  @ApiOperation({ summary: 'Get active SIGMETs and AIRMETs as GeoJSON' })
  async getSigmets(): Promise<SigmetCollection> {
    return this.weatherService.getSigmets();
  }

  @Get('crosswind')
  @ApiOperation({ summary: 'Get crosswind analysis for an airport' })
  @ApiQuery({
    name: 'icao',
    required: true,
    description: 'ICAO code of the airport',
    example: 'SBSP',
  })
  async getCrosswind(@Query('icao') icao: string): Promise<CrosswindAnalysis> {
    return this.weatherService.getCrosswind(icao);
  }

  @Get('route-impact')
  @ApiOperation({ summary: 'Get weather impact along a route' })
  @ApiQuery({
    name: 'waypoints',
    required: true,
    description: 'Semicolon-separated lat,lon pairs',
    example: '-23.62,-46.65;-22.91,-43.17',
  })
  @ApiQuery({
    name: 'altitude',
    required: false,
    description: 'Cruise altitude in feet',
    example: '5000',
  })
  async getRouteImpact(
    @Query('waypoints') waypointsStr: string,
    @Query('altitude') altitudeStr?: string,
  ): Promise<unknown> {
    const waypoints = waypointsStr
      .split(';')
      .map((pair) => {
        const [lat, lon] = pair.split(',').map(Number);
        return { lat: lat!, lon: lon! };
      })
      .filter((wp) => !isNaN(wp.lat) && !isNaN(wp.lon));

    const altitude = altitudeStr ? parseInt(altitudeStr, 10) : 5000;

    return this.weatherService.getRouteWeatherImpact(waypoints, altitude);
  }

  @Post('route-safety')
  @ApiOperation({ summary: 'Full route weather assessment: aerodrome wx, SIGMET intersection, winds aloft' })
  async getRouteSafety(
    @Body() body: {
      waypoints: { lat: number; lon: number }[];
      originIcao?: string;
      destinationIcao?: string;
      alternateIcao?: string;
      cruiseLevel?: string;
      cruiseSpeedKts?: number;
      fuelBurnLph?: number;
      totalDistanceNm?: number;
      departureEpochSec?: number;
      arrivalEpochSec?: number;
    },
  ): Promise<RouteSafetyResponse> {
    const waypoints = (body.waypoints ?? []).filter(
      (wp) => typeof wp.lat === 'number' && typeof wp.lon === 'number' && !isNaN(wp.lat) && !isNaN(wp.lon),
    );

    return this.weatherService.assessRouteSafety({
      waypoints,
      originIcao: body.originIcao ?? null,
      destinationIcao: body.destinationIcao ?? null,
      alternateIcao: body.alternateIcao ?? null,
      cruiseLevel: body.cruiseLevel ?? null,
      cruiseSpeedKts: body.cruiseSpeedKts ?? null,
      fuelBurnLph: body.fuelBurnLph ?? null,
      totalDistanceNm: body.totalDistanceNm ?? 0,
      departureEpochSec: body.departureEpochSec ?? null,
      arrivalEpochSec: body.arrivalEpochSec ?? null,
    });
  }
}
