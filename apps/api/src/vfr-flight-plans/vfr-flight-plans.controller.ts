import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { User } from '@prisma/client';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

import { CreateVfrFlightPlanDto } from './dto/create-vfr-flight-plan.dto';
import { UpdateVfrFlightPlanDto } from './dto/update-vfr-flight-plan.dto';
import { VfrFlightPlansService } from './vfr-flight-plans.service';

@ApiTags('vfr-flight-plans')
@Controller('vfr-flight-plans')
@UseGuards(JwtAuthGuard)
export class VfrFlightPlansController {
  constructor(private readonly vfrFlightPlansService: VfrFlightPlansService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new VFR flight plan' })
  async create(
    @CurrentUser() user: User,
    @Body() dto: CreateVfrFlightPlanDto,
  ): Promise<unknown> {
    return this.vfrFlightPlansService.create(user.id, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List all VFR flight plans for the current user' })
  async findAll(@CurrentUser() user: User): Promise<unknown> {
    return this.vfrFlightPlansService.findAll(user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a VFR flight plan by ID' })
  async findOne(@CurrentUser() user: User, @Param('id') id: string): Promise<unknown> {
    return this.vfrFlightPlansService.findOne(id, user.id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a VFR flight plan' })
  async update(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() dto: UpdateVfrFlightPlanDto,
  ): Promise<unknown> {
    return this.vfrFlightPlansService.update(id, user.id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete a VFR flight plan' })
  async remove(@CurrentUser() user: User, @Param('id') id: string): Promise<void> {
    await this.vfrFlightPlansService.remove(id, user.id);
  }
}
