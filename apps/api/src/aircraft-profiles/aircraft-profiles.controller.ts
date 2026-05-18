import { CreateAircraftProfileSchema, UpdateAircraftProfileSchema } from '@fs-suite/types';
import type { AircraftCatalogEntry, UserAircraftProfile } from '@fs-suite/types';
import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { User } from '@prisma/client';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';

import { AircraftProfilesService } from './aircraft-profiles.service';
import { CreateAircraftProfileDto } from './dto/create-aircraft-profile.dto';
import { UpdateAircraftProfileDto } from './dto/update-aircraft-profile.dto';

@ApiTags('aircraft-profiles')
@Controller('aircraft-profiles')
@UseGuards(JwtAuthGuard)
export class AircraftProfilesController {
  constructor(private readonly service: AircraftProfilesService) {}

  @Get('catalog')
  @ApiOperation({ summary: 'List all system aircraft templates' })
  async catalog(): Promise<AircraftCatalogEntry[]> {
    return this.service.findAllTemplates();
  }

  @Get()
  @ApiOperation({ summary: "List user's aircraft profiles" })
  async findAll(@CurrentUser() user: User): Promise<UserAircraftProfile[]> {
    return this.service.findAllByUser(user.id);
  }

  @Post(':id/clone')
  @ApiOperation({ summary: 'Clone a system template into user profiles' })
  async clone(
    @CurrentUser() user: User,
    @Param('id') id: string,
  ): Promise<UserAircraftProfile> {
    return this.service.clone(id, user.id);
  }

  @Post()
  @ApiOperation({ summary: 'Create aircraft profile' })
  async create(
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(CreateAircraftProfileSchema)) dto: CreateAircraftProfileDto,
  ): Promise<UserAircraftProfile> {
    return this.service.create(user.id, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update aircraft profile' })
  async update(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateAircraftProfileSchema)) dto: UpdateAircraftProfileDto,
  ): Promise<UserAircraftProfile> {
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
