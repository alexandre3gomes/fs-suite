import {
  Body,
  Controller,
  Post,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { User } from '@prisma/client';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

import { CreateFeedbackDto } from './dto/create-feedback.dto';
import {
  MAX_ATTACHMENTS,
  MAX_ATTACHMENT_BYTES,
} from './feedback-attachments.service';
import { FeedbackService } from './feedback.service';

@ApiTags('feedback')
@Controller('feedback')
@UseGuards(JwtAuthGuard)
export class FeedbackController {
  constructor(private readonly feedback: FeedbackService) {}

  @Post()
  @ApiOperation({ summary: 'Submit a bug report or suggestion (with optional attachments)' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FilesInterceptor('files', MAX_ATTACHMENTS, {
      limits: { fileSize: MAX_ATTACHMENT_BYTES, files: MAX_ATTACHMENTS },
    }),
  )
  async create(
    @CurrentUser() user: User,
    @Body() dto: CreateFeedbackDto,
    @UploadedFiles() files?: Express.Multer.File[],
  ): Promise<{ id: string }> {
    return this.feedback.create(user, dto, files ?? []);
  }
}
