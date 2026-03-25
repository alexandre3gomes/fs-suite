import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { User } from '@prisma/client';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

import { AircraftProfilesService } from './aircraft-profiles.service';
import { CreateAircraftProfileDto } from './dto/create-aircraft-profile.dto';
import { UpdateAircraftProfileDto } from './dto/update-aircraft-profile.dto';

@ApiTags('aircraft-profiles')
@Controller('aircraft-profiles')
@UseGuards(JwtAuthGuard)
export class AircraftProfilesController {
  constructor(private readonly service: AircraftProfilesService) {}

  @Get()
  @ApiOperation({ summary: "List user's aircraft profiles" })
  async findAll(@CurrentUser() user: User): Promise<unknown> {
    return this.service.findAllByUser(user.id);
  }

  @Post()
  @ApiOperation({ summary: 'Create aircraft profile' })
  async create(
    @CurrentUser() user: User,
    @Body() dto: CreateAircraftProfileDto,
  ): Promise<unknown> {
    return this.service.create(user.id, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update aircraft profile' })
  async update(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() dto: UpdateAircraftProfileDto,
  ): Promise<unknown> {
    return this.service.update(id, user.id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete aircraft profile' })
  async remove(
    @CurrentUser() user: User,
    @Param('id') id: string,
  ): Promise<void> {
    await this.service.remove(id, user.id);
  }
}
