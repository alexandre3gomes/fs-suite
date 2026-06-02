import {
  BadGatewayException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  type Feedback,
  type FeedbackAttachment,
  FeedbackStatus,
  type User,
} from '@prisma/client';

import { ActivityService } from '../activity/activity.service';
import { PrismaService } from '../prisma/prisma.service';

import { CreateFeedbackDto } from './dto/create-feedback.dto';
import { ListFeedbackQueryDto } from './dto/list-feedback-query.dto';
import { FeedbackAttachmentsService } from './feedback-attachments.service';
import { FeedbackMailerService } from './feedback-mailer.service';

export interface FeedbackAttachmentDto {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
}

export interface FeedbackSummaryDto {
  id: string;
  type: Feedback['type'];
  status: Feedback['status'];
  reporterName: string;
  reporterEmail: string;
  description: string;
  attachmentCount: number;
  hasReply: boolean;
  createdAt: string;
  repliedAt: string | null;
  resolvedAt: string | null;
}

export interface FeedbackDetailDto extends FeedbackSummaryDto {
  adminReply: string | null;
  repliedByName: string | null;
  attachments: FeedbackAttachmentDto[];
}

type FeedbackWithRelations = Feedback & {
  attachments: FeedbackAttachment[];
  repliedBy: Pick<User, 'name'> | null;
  _count?: { attachments: number };
};

@Injectable()
export class FeedbackService {
  private readonly logger = new Logger(FeedbackService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly attachments: FeedbackAttachmentsService,
    private readonly mailer: FeedbackMailerService,
    private readonly activity: ActivityService,
  ) {}

  // --- user-facing ---------------------------------------------------------

  async create(
    user: User,
    dto: CreateFeedbackDto,
    files: Express.Multer.File[],
  ): Promise<{ id: string }> {
    // Validate (and re-encode) attachments BEFORE writing anything, so an
    // invalid file never leaves an orphan row or object behind.
    const processed = await this.attachments.validate(files);

    const feedback = await this.prisma.feedback.create({
      data: {
        type: dto.type,
        description: dto.description,
        userId: user.id,
        reporterEmail: user.email,
        reporterName: user.name,
      },
    });

    if (processed.length > 0) {
      try {
        const stored = await this.attachments.store(feedback.id, processed);
        await this.prisma.feedbackAttachment.createMany({
          data: stored.map((s) => ({ feedbackId: feedback.id, ...s })),
        });
      } catch (err) {
        // Storage is required: roll back the feedback row so the user can retry
        // cleanly rather than ending up with a record whose attachments 404.
        await this.prisma.feedback.delete({ where: { id: feedback.id } }).catch(() => undefined);
        this.logger.warn(`Feedback ${feedback.id} rolled back: ${(err as Error).message}`);
        throw new ServiceUnavailableException(
          'Não foi possível salvar os anexos. Tente novamente.',
        );
      }
    }

    void this.activity.log('feedback.created', user.id, {
      feedbackId: feedback.id,
      type: feedback.type,
      attachmentCount: processed.length,
    });

    // Best-effort — never blocks the user's submission.
    void this.mailer.notifyAdmins(feedback, processed.length);

    return { id: feedback.id };
  }

  // --- admin-facing --------------------------------------------------------

  async listForAdmin(query: ListFeedbackQueryDto): Promise<FeedbackSummaryDto[]> {
    const rows = await this.prisma.feedback.findMany({
      where: {
        deletedAt: null,
        ...(query.status ? { status: query.status } : {}),
        ...(query.type ? { type: query.type } : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { attachments: true } } },
    });
    return rows.map((r) => this.toSummary(r as FeedbackWithRelations));
  }

  async getForAdmin(id: string): Promise<FeedbackDetailDto> {
    const row = await this.prisma.feedback.findFirst({
      where: { id, deletedAt: null },
      include: {
        attachments: { orderBy: { createdAt: 'asc' } },
        repliedBy: { select: { name: true } },
      },
    });
    if (!row) throw new NotFoundException('Feedback not found');
    return this.toDetail(row as FeedbackWithRelations);
  }

  async reply(admin: User, id: string, message: string): Promise<FeedbackDetailDto> {
    const feedback = await this.prisma.feedback.findFirst({
      where: { id, deletedAt: null },
    });
    if (!feedback) throw new NotFoundException('Feedback not found');

    // Send first: the user-facing effect is what matters. If it fails we don't
    // mark the item answered, so the admin can retry cleanly.
    try {
      await this.mailer.sendReply(feedback, message, admin);
    } catch (err) {
      this.logger.warn(`Feedback reply email failed for ${id}: ${(err as Error).message}`);
      throw new BadGatewayException('Não foi possível enviar o email de resposta.');
    }

    await this.prisma.feedback.update({
      where: { id },
      data: {
        adminReply: message,
        repliedById: admin.id,
        repliedAt: new Date(),
        // Replying answers it; don't override a manual RESOLVED close.
        ...(feedback.status === FeedbackStatus.RESOLVED
          ? {}
          : { status: FeedbackStatus.ANSWERED }),
      },
    });

    void this.activity.log('feedback.answered', admin.id, { feedbackId: id });

    return this.getForAdmin(id);
  }

  async setStatus(
    admin: User,
    id: string,
    status: FeedbackStatus,
  ): Promise<FeedbackDetailDto> {
    const feedback = await this.prisma.feedback.findFirst({
      where: { id, deletedAt: null },
    });
    if (!feedback) throw new NotFoundException('Feedback not found');

    await this.prisma.feedback.update({
      where: { id },
      data: {
        status,
        resolvedAt: status === FeedbackStatus.RESOLVED ? new Date() : null,
      },
    });

    void this.activity.log(
      status === FeedbackStatus.RESOLVED ? 'feedback.resolved' : 'feedback.reopened',
      admin.id,
      { feedbackId: id, status },
    );

    return this.getForAdmin(id);
  }

  /** Look up an attachment for the admin streaming endpoint. */
  async getAttachmentForStream(
    feedbackId: string,
    attachmentId: string,
  ): Promise<Pick<FeedbackAttachment, 'storageKey' | 'contentType' | 'fileName'>> {
    const attachment = await this.prisma.feedbackAttachment.findFirst({
      where: { id: attachmentId, feedbackId, feedback: { deletedAt: null } },
      select: { storageKey: true, contentType: true, fileName: true },
    });
    if (!attachment) throw new NotFoundException('Attachment not found');
    return attachment;
  }

  // --- mapping -------------------------------------------------------------

  private toSummary(r: FeedbackWithRelations): FeedbackSummaryDto {
    return {
      id: r.id,
      type: r.type,
      status: r.status,
      reporterName: r.reporterName,
      reporterEmail: r.reporterEmail,
      description: r.description,
      attachmentCount: r._count?.attachments ?? r.attachments?.length ?? 0,
      hasReply: r.adminReply != null,
      createdAt: r.createdAt.toISOString(),
      repliedAt: r.repliedAt ? r.repliedAt.toISOString() : null,
      resolvedAt: r.resolvedAt ? r.resolvedAt.toISOString() : null,
    };
  }

  private toDetail(r: FeedbackWithRelations): FeedbackDetailDto {
    return {
      ...this.toSummary(r),
      adminReply: r.adminReply,
      repliedByName: r.repliedBy?.name ?? null,
      attachments: (r.attachments ?? []).map((a) => ({
        id: a.id,
        fileName: a.fileName,
        contentType: a.contentType,
        sizeBytes: a.sizeBytes,
      })),
    };
  }
}
