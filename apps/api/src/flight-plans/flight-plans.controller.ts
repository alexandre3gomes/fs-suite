import {
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { User } from '@prisma/client';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

import { CreateFlightPlanDto } from './dto/create-flight-plan.dto';
import { UpdateFlightPlanDto } from './dto/update-flight-plan.dto';
import { FlightPlansService } from './flight-plans.service';

@ApiTags('flight-plans')
@Controller('flight-plans')
@UseGuards(JwtAuthGuard)
export class FlightPlansController {
  constructor(private readonly service: FlightPlansService) {}

  @Get()
  @ApiOperation({ summary: "List user's saved flight plans (paginated)" })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async findAll(
    @CurrentUser() user: User,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ): Promise<unknown> {
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const safePage = Math.max(page, 1);
    return this.service.findAll(user.id, safePage, safeLimit);
  }

  @Post()
  @ApiOperation({ summary: 'Create new flight plan' })
  async create(
    @CurrentUser() user: User,
    @Body() dto: CreateFlightPlanDto,
  ): Promise<unknown> {
    return this.service.create(user.id, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get full plan with route' })
  async findOne(
    @CurrentUser() user: User,
    @Param('id') id: string,
  ): Promise<unknown> {
    return this.service.findOne(id, user.id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update plan' })
  async update(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() dto: UpdateFlightPlanDto,
  ): Promise<unknown> {
    return this.service.update(id, user.id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft delete plan' })
  async remove(
    @CurrentUser() user: User,
    @Param('id') id: string,
  ): Promise<void> {
    await this.service.remove(id, user.id);
  }

  @Post(':id/duplicate')
  @ApiOperation({ summary: 'Duplicate plan as new draft' })
  async duplicate(
    @CurrentUser() user: User,
    @Param('id') id: string,
  ): Promise<unknown> {
    return this.service.duplicate(id, user.id);
  }
}
