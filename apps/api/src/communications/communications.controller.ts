import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Communication, User } from '@prisma/client';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AdminGuard } from '../common/guards/admin.guard';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { EmailService, type SendResult } from '../email/email.service';

import { type CommunicationImage, CommunicationsService } from './communications.service';
import { CreateCommunicationDto } from './dto/create-communication.dto';
import { UpdateCommunicationDto } from './dto/update-communication.dto';
import { UploadImageDto } from './dto/upload-image.dto';

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminGuard)
@SkipThrottle()
@Controller('admin/communications')
export class CommunicationsController {
  constructor(
    private readonly service: CommunicationsService,
    private readonly email: EmailService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create a draft communication' })
  create(@CurrentUser() user: User, @Body() dto: CreateCommunicationDto): Promise<Communication> {
    return this.service.create(dto, user.email);
  }

  @Get()
  @ApiOperation({ summary: 'List communications with delivery counts' })
  list(): Promise<Array<Communication & { _count: { deliveries: number } }>> {
    return this.service.list();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single communication' })
  getOne(@Param('id') id: string): Promise<Communication> {
    return this.service.getOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Edit a draft communication' })
  update(@Param('id') id: string, @Body() dto: UpdateCommunicationDto): Promise<Communication> {
    return this.service.update(id, dto);
  }

  @Post(':id/images')
  @ApiOperation({ summary: 'Attach a screenshot (base64) to a draft' })
  addImage(@Param('id') id: string, @Body() dto: UploadImageDto): Promise<CommunicationImage> {
    return this.service.addImage(id, dto);
  }

  @Post(':id/upload-image')
  @ApiOperation({ summary: 'Upload an inline image (base64) and return its URL' })
  uploadImage(
    @Param('id') id: string,
    @Body() dto: UploadImageDto,
  ): Promise<{ url: string; path: string }> {
    return this.service.uploadImage(id, dto);
  }

  @Delete(':id/images')
  @ApiOperation({ summary: 'Remove a screenshot by storage path' })
  removeImage(
    @Param('id') id: string,
    @Query('path') path: string,
  ): Promise<CommunicationImage[]> {
    return this.service.removeImage(id, path);
  }

  @Post(':id/send')
  @ApiOperation({ summary: 'Send a communication (?dryRun=true preview, ?adminOnly=true test)' })
  send(
    @Param('id') id: string,
    @Query('dryRun') dryRun?: string,
    @Query('adminOnly') adminOnly?: string,
  ): Promise<SendResult> {
    return this.email.sendCommunication(id, {
      dryRun: dryRun === 'true' || dryRun === '1',
      adminOnly: adminOnly === 'true' || adminOnly === '1',
    });
  }
}
