import { Injectable, Logger } from '@nestjs/common';

import { ActivityService } from '../../activity/activity.service';
import { EncryptionService } from '../../common/encryption/encryption.service';
import { PrismaService } from '../../prisma/prisma.service';

import type { SaveAiKeyDto } from './dto/save-ai-key.dto';

const SERVICE_NAME = 'ai-validation';

@Injectable()
export class AiValidationIntegrationService {
  private readonly logger = new Logger(AiValidationIntegrationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
    private readonly activity: ActivityService,
  ) {}

  async saveConnection(
    userId: string,
    dto: SaveAiKeyDto,
  ): Promise<{ provider: string }> {
    const encryptedApiKey = this.encryption.encrypt(dto.apiKey);

    await this.prisma.integrationConnection.upsert({
      where: { userId_service: { userId, service: SERVICE_NAME } },
      update: { metadata: { provider: dto.provider, encryptedApiKey } },
      create: {
        userId,
        service: SERVICE_NAME,
        metadata: { provider: dto.provider, encryptedApiKey },
      },
    });

    void this.activity.log('ai_validation.key_saved', userId, {
      provider: dto.provider,
    });

    return { provider: dto.provider };
  }

  async getConnection(
    userId: string,
  ): Promise<{ provider: string | null; hasKey: boolean }> {
    const conn = await this.prisma.integrationConnection.findUnique({
      where: { userId_service: { userId, service: SERVICE_NAME } },
    });

    if (!conn?.metadata) return { provider: null, hasKey: false };

    const meta = conn.metadata as {
      provider?: string;
      encryptedApiKey?: string;
    };
    return {
      provider: meta.provider ?? null,
      hasKey: !!meta.encryptedApiKey,
    };
  }

  async deleteConnection(userId: string): Promise<void> {
    await this.prisma.integrationConnection.deleteMany({
      where: { userId, service: SERVICE_NAME },
    });

    void this.activity.log('ai_validation.key_deleted', userId);
  }
}
