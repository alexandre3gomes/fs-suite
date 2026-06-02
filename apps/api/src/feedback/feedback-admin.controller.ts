import { pipeline } from 'stream/promises';

import {
  Controller,
  Get,
  Logger,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Res,
  Body,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { User } from '@prisma/client';
import type { Response } from 'express';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AdminGuard } from '../common/guards/admin.guard';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { R2StorageService } from '../r2/r2-storage.service';

import { ListFeedbackQueryDto } from './dto/list-feedback-query.dto';
import { ReplyFeedbackDto } from './dto/reply-feedback.dto';
import { UpdateFeedbackStatusDto } from './dto/update-feedback-status.dto';
import {
  FeedbackDetailDto,
  FeedbackService,
  FeedbackSummaryDto,
} from './feedback.service';

@ApiTags('admin')
@Controller('admin/feedback')
@UseGuards(JwtAuthGuard, AdminGuard)
export class FeedbackAdminController {
  private readonly logger = new Logger(FeedbackAdminController.name);

  constructor(
    private readonly feedback: FeedbackService,
    private readonly r2: R2StorageService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List user feedback (newest first), optionally filtered' })
  list(@Query() query: ListFeedbackQueryDto): Promise<FeedbackSummaryDto[]> {
    return this.feedback.listForAdmin(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single feedback with attachments and reply' })
  get(@Param('id') id: string): Promise<FeedbackDetailDto> {
    return this.feedback.getForAdmin(id);
  }

  @Post(':id/reply')
  @ApiOperation({ summary: 'Reply to a feedback (emails the reporter)' })
  reply(
    @CurrentUser() admin: User,
    @Param('id') id: string,
    @Body() dto: ReplyFeedbackDto,
  ): Promise<FeedbackDetailDto> {
    return this.feedback.reply(admin, id, dto.message);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Update feedback status (no email is sent)' })
  setStatus(
    @CurrentUser() admin: User,
    @Param('id') id: string,
    @Body() dto: UpdateFeedbackStatusDto,
  ): Promise<FeedbackDetailDto> {
    return this.feedback.setStatus(admin, id, dto.status);
  }

  @Get(':id/attachments/:attachmentId')
  @ApiOperation({ summary: 'Stream a feedback attachment (admin only)' })
  async streamAttachment(
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
    @Res() res: Response,
  ): Promise<void> {
    const attachment = await this.feedback.getAttachmentForStream(id, attachmentId);
    const obj = await this.r2.getObject(attachment.storageKey);
    if (!obj) throw new NotFoundException('Attachment not available');

    res.setHeader('Content-Type', attachment.contentType);
    // Never inline — force download/preview as an attachment, never as HTML.
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(attachment.fileName)}"`,
    );
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (obj.contentLength) res.setHeader('Content-Length', obj.contentLength);

    try {
      await pipeline(obj.body, res);
    } catch (err) {
      this.logger.warn(`Attachment stream failed for ${attachmentId}: ${(err as Error).message}`);
      if (!res.headersSent) res.status(502).end();
      else res.end();
    }
  }
}
