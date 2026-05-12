import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { User } from '@prisma/client';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

import { AiValidationIntegrationService } from './ai-validation-integration.service';
import { SaveAiKeyDto } from './dto/save-ai-key.dto';

@ApiTags('integrations/ai-validation')
@Controller('integrations/ai-validation')
@UseGuards(JwtAuthGuard)
export class AiValidationIntegrationController {
  constructor(
    private readonly service: AiValidationIntegrationService,
  ) {}

  @Patch('connection')
  @ApiOperation({ summary: "Save or update user's AI provider API key (encrypted)" })
  async updateConnection(
    @CurrentUser() user: User,
    @Body() dto: SaveAiKeyDto,
  ): Promise<{ provider: string }> {
    return this.service.saveConnection(user.id, dto);
  }

  @Get('connection')
  @ApiOperation({ summary: "Get user's AI validation connection status" })
  async getConnection(
    @CurrentUser() user: User,
  ): Promise<{ provider: string | null; hasKey: boolean }> {
    return this.service.getConnection(user.id);
  }

  @Delete('connection')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Delete user's AI provider API key" })
  async deleteConnection(@CurrentUser() user: User): Promise<void> {
    await this.service.deleteConnection(user.id);
  }
}
