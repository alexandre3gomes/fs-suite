import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

import { ReaService } from './rea.service';

@ApiTags('rea')
@Controller('rea')
@UseGuards(JwtAuthGuard)
export class ReaController {
  constructor(private readonly rea: ReaService) {}

  @Get('regions')
  @ApiOperation({ summary: 'List all REA regions with chart PDF URLs' })
  async listRegions() {
    return this.rea.listRegions();
  }

  @Get('region/:regionId')
  @ApiOperation({ summary: 'Get all REA corridor data for a specific region' })
  async getRegion(@Param('regionId') regionId: string) {
    const data = await this.rea.getRegionData(regionId);
    if (!data) return { error: 'Region not found', regionId };
    return data;
  }

  @Get('detect')
  @ApiOperation({ summary: 'Detect REA corridors crossed by a route' })
  @ApiQuery({ name: 'waypoints', description: 'Comma-separated lat:lon pairs (e.g. -23.5:-46.6,-22.9:-43.1)', required: true })
  async detect(@Query('waypoints') waypointsStr: string) {
    const waypoints = this.parseWaypoints(waypointsStr);
    if (waypoints.length < 2) {
      return { regions: [] };
    }
    return this.rea.detectReaForRoute(waypoints);
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
