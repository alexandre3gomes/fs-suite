import { Controller, Get, NotFoundException, Param, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

import { AirportsService } from './airports.service';

@ApiTags('airports')
@Controller('airports')
@UseGuards(JwtAuthGuard)
export class AirportsController {
  constructor(private readonly airportsService: AirportsService) {}

  @Get()
  @ApiOperation({ summary: 'Search airports by ICAO or name' })
  @ApiQuery({ name: 'q', required: true, description: 'Search query (min 2 chars)' })
  async search(@Query('q') query: string): Promise<unknown> {
    if (!query || query.trim().length < 2) {
      return [];
    }
    return this.airportsService.search(query);
  }

  @Get(':icao')
  @ApiOperation({ summary: 'Get airport by ICAO code' })
  async findOne(@Param('icao') icao: string): Promise<unknown> {
    const airport = await this.airportsService.findByIcao(icao);
    if (!airport) {
      throw new NotFoundException(`Airport ${icao.toUpperCase()} not found`);
    }
    return airport;
  }
}
