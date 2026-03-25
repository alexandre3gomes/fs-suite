import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { User } from '@prisma/client';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

import { UpdateSimBriefConnectionDto } from './dto/update-simbrief-connection.dto';
import { SimBriefService } from './simbrief.service';

@ApiTags('integrations/simbrief')
@Controller('integrations/simbrief')
@UseGuards(JwtAuthGuard)
export class SimBriefController {
  constructor(private readonly simBriefService: SimBriefService) {}

  @Patch('connection')
  @ApiOperation({ summary: "Save or update user's SimBrief pilot ID" })
  async updateConnection(
    @CurrentUser() user: User,
    @Body() dto: UpdateSimBriefConnectionDto,
  ): Promise<unknown> {
    return this.simBriefService.saveConnection(user.id, dto);
  }

  @Get('connection')
  @ApiOperation({ summary: "Get user's SimBrief connection status" })
  async getConnection(@CurrentUser() user: User): Promise<unknown> {
    return this.simBriefService.getConnection(user.id) ?? { pilotId: null };
  }

  @Get('ofp')
  @ApiOperation({ summary: "Fetch latest OFP for the authenticated user's pilot ID" })
  async fetchOfp(@CurrentUser() user: User): Promise<unknown> {
    return this.simBriefService.fetchOfp(user.id);
  }
}
