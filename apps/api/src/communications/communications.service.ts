import { randomUUID } from 'crypto';

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { type Communication, CommunicationStatus, Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { SupabaseStorageService } from '../supabase/supabase-storage.service';

import type { CreateCommunicationDto } from './dto/create-communication.dto';
import type { UpdateCommunicationDto } from './dto/update-communication.dto';
import type { AllowedImageType, UploadImageDto } from './dto/upload-image.dto';

export interface CommunicationImage {
  url: string;
  path: string;
  caption?: string;
}

const EXT_BY_TYPE: Record<AllowedImageType, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

@Injectable()
export class CommunicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: SupabaseStorageService,
  ) {}

  create(dto: CreateCommunicationDto, createdByEmail: string): Promise<Communication> {
    return this.prisma.communication.create({
      data: {
        type: dto.type,
        subject: dto.subject,
        body: dto.body,
        createdByEmail,
      },
    });
  }

  list(): Promise<Array<Communication & { _count: { deliveries: number } }>> {
    return this.prisma.communication.findMany({
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { deliveries: true } } },
    });
  }

  async getOne(id: string): Promise<Communication> {
    const comm = await this.prisma.communication.findUnique({ where: { id } });
    if (!comm) throw new NotFoundException('Communication not found');
    return comm;
  }

  async update(id: string, dto: UpdateCommunicationDto): Promise<Communication> {
    const comm = await this.getOne(id);
    this.assertDraft(comm);
    return this.prisma.communication.update({
      where: { id },
      data: {
        ...(dto.type !== undefined && { type: dto.type }),
        ...(dto.subject !== undefined && { subject: dto.subject }),
        ...(dto.body !== undefined && { body: dto.body }),
      },
    });
  }

  images(comm: Communication): CommunicationImage[] {
    return (comm.images as unknown as CommunicationImage[]) ?? [];
  }

  /**
   * Upload an image to storage and return its public URL — WITHOUT touching the
   * communication's `images` array. Used for images embedded inline in the body
   * markdown (`![](url)`), which is how the admin composes screenshots.
   */
  async uploadImage(id: string, dto: UploadImageDto): Promise<{ url: string; path: string }> {
    const comm = await this.getOne(id);
    this.assertDraft(comm);
    if (!this.storage.isEnabled()) {
      throw new BadRequestException('Image storage is not configured');
    }

    const buffer = Buffer.from(dto.dataBase64, 'base64');
    if (buffer.length === 0) throw new BadRequestException('Empty image');
    if (buffer.length > 6 * 1024 * 1024) throw new BadRequestException('Image exceeds 6MB');

    const path = `${id}/${randomUUID()}.${EXT_BY_TYPE[dto.contentType]}`;
    const url = await this.storage.upload(path, buffer, dto.contentType);
    return { url, path };
  }

  async addImage(id: string, dto: UploadImageDto): Promise<CommunicationImage> {
    const { url, path } = await this.uploadImage(id, dto);
    const comm = await this.getOne(id);
    const image: CommunicationImage = { url, path, ...(dto.caption ? { caption: dto.caption } : {}) };
    const next = [...this.images(comm), image];
    await this.persistImages(id, next);
    return image;
  }

  async removeImage(id: string, path: string): Promise<CommunicationImage[]> {
    const comm = await this.getOne(id);
    this.assertDraft(comm);
    const next = this.images(comm).filter((img) => img.path !== path);
    await this.persistImages(id, next);
    return next;
  }

  private persistImages(id: string, images: CommunicationImage[]): Promise<Communication> {
    return this.prisma.communication.update({
      where: { id },
      data: { images: images as unknown as Prisma.InputJsonValue },
    });
  }

  private assertDraft(comm: Communication): void {
    if (comm.status !== CommunicationStatus.DRAFT) {
      throw new BadRequestException('Communication already sent — it can no longer be edited');
    }
  }
}
