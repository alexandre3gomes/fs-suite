import type { VfrLayerDescriptor } from '@fs-suite/types';
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

import { listVfrLayers } from './vfr-layers.catalog';

/**
 * Catalog of published VFR layers (worldwide model). Metadata/discovery only —
 * the actual data is served by each layer's own endpoint/source (e.g. /v1/rea
 * for BR_REA). See docs/vfr-layer-model.md.
 */
@ApiTags('vfr-layers')
@Controller('vfr-layers')
@UseGuards(JwtAuthGuard)
export class VfrLayersController {
  @Get()
  @ApiOperation({ summary: 'List published VFR layers (optionally filtered by country)' })
  @ApiQuery({ name: 'country', required: false, description: 'ISO 3166-1 alpha-2, e.g. BR' })
  list(@Query('country') country?: string): VfrLayerDescriptor[] {
    return listVfrLayers(country);
  }
}
