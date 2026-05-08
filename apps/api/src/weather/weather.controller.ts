import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

import { WeatherService } from './weather.service';

@ApiTags('weather')
@Controller('weather')
@UseGuards(JwtAuthGuard)
export class WeatherController {
  constructor(private readonly weatherService: WeatherService) {}

  @Get('metar')
  @ApiOperation({ summary: 'Get METAR for one or more ICAO codes' })
  @ApiQuery({
    name: 'icaos',
    required: true,
    description: 'Comma-separated ICAO codes (max 50)',
    example: 'SBSP,SBGR,SBKP',
  })
  async getMetars(@Query('icaos') icaos: string): Promise<unknown> {
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
}
