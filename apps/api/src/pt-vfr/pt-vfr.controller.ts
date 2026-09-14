import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

import { type PtVfrPointsResponse, type PtVfrRoutesResponse, PtVfrService } from './pt-vfr.service';

@ApiTags('pt-vfr')
@Controller('pt-vfr')
@UseGuards(JwtAuthGuard)
export class PtVfrController {
  constructor(private readonly ptVfr: PtVfrService) {}

  @Get('routes')
  @ApiOperation({ summary: 'Portugal VFR tunnels/routes (NAV Portugal eVFR ENR 3.5)' })
  getRoutes(): PtVfrRoutesResponse {
    return this.ptVfr.getRoutes();
  }

  @Get('points')
  @ApiOperation({ summary: 'Portugal VFR significant points (NAV Portugal eVFR ENR 4.4)' })
  getPoints(): PtVfrPointsResponse {
    return this.ptVfr.getPoints();
  }
}
