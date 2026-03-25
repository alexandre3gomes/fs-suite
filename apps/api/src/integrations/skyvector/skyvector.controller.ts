import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

import { SkyVectorService } from './skyvector.service';

@ApiTags('integrations/skyvector')
@Controller('integrations/skyvector')
@UseGuards(JwtAuthGuard)
export class SkyVectorController {
  constructor(private readonly skyVectorService: SkyVectorService) {}

  @Get('url')
  @ApiOperation({ summary: 'Build contextual SkyVector URL' })
  @ApiQuery({ name: 'originIcao', required: true })
  @ApiQuery({ name: 'destinationIcao', required: true })
  @ApiQuery({ name: 'route', required: false })
  buildUrl(
    @Query('originIcao') originIcao: string,
    @Query('destinationIcao') destinationIcao: string,
    @Query('route') route?: string,
  ): { url: string } {
    return this.skyVectorService.buildUrl(originIcao, destinationIcao, route);
  }
}
