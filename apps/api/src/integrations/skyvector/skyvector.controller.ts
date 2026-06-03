import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

import { ImportFplDto } from './dto/import-fpl.dto';
import { type FplImportResult, SkyVectorService } from './skyvector.service';

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

  @Post('import')
  @ApiOperation({ summary: 'Import a Garmin/SkyVector .fpl flight plan (route + resolved origin/destination)' })
  import(@Body() dto: ImportFplDto): Promise<FplImportResult> {
    return this.skyVectorService.importFpl(dto.fpl);
  }
}
