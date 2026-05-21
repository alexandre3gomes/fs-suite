import {
  assessConformity,
  formatIcaoFlightPlanText,
  projectFlightPlanToIcao,
  type ConformityReport,
  type IcaoFlightPlanProjection,
} from '@fs-suite/types';
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
import { WeatherService } from '../weather/weather.service';

import { CreateFlightPlanDto } from './dto/create-flight-plan.dto';
import { UpdateFlightPlanDto } from './dto/update-flight-plan.dto';
import { FlightPlansService } from './flight-plans.service';

@ApiTags('flight-plans')
@Controller('flight-plans')
@UseGuards(JwtAuthGuard)
export class FlightPlansController {
  constructor(
    private readonly service: FlightPlansService,
    private readonly weatherService: WeatherService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create a new flight plan' })
  async create(
    @CurrentUser() user: User,
    @Body() dto: CreateFlightPlanDto,
  ): Promise<unknown> {
    return this.service.create(user.id, dto);
  }

  @Get()
  @ApiOperation({ summary: "List user's flight plans" })
  async findAll(@CurrentUser() user: User): Promise<unknown> {
    return this.service.findAll(user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a flight plan by ID' })
  async findOne(@CurrentUser() user: User, @Param('id') id: string): Promise<unknown> {
    return this.service.findOne(id, user.id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a flight plan' })
  async update(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() dto: UpdateFlightPlanDto,
  ): Promise<unknown> {
    return this.service.update(id, user.id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete a flight plan' })
  async remove(@CurrentUser() user: User, @Param('id') id: string): Promise<void> {
    await this.service.remove(id, user.id);
  }

  @Post(':id/duplicate')
  @ApiOperation({ summary: 'Duplicate plan as new draft' })
  async duplicate(@CurrentUser() user: User, @Param('id') id: string): Promise<unknown> {
    return this.service.duplicate(id, user.id);
  }

  @Get(':id/safety-assessment')
  @ApiOperation({ summary: 'Assess flight safety based on current weather' })
  async safetyAssessment(@CurrentUser() user: User, @Param('id') id: string): Promise<unknown> {
    const plan = await this.service.findOne(id, user.id);
    return this.weatherService.assessFlightPlanSafety(plan);
  }

  @Get(':id/icao')
  @ApiOperation({ summary: 'ICAO flight plan projection, conformity report, and text export' })
  async icaoProjection(
    @CurrentUser() user: User,
    @Param('id') id: string,
  ): Promise<{
    projection: IcaoFlightPlanProjection;
    conformity: ConformityReport;
    text: string;
  }> {
    const plan = await this.service.findOne(id, user.id);
    const projection = projectFlightPlanToIcao(plan as never);
    const conformity = assessConformity(plan as never);
    const text = formatIcaoFlightPlanText(projection);
    return { projection, conformity, text };
  }
}
