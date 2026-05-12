import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { User } from '@prisma/client';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

import { AiValidationService } from './ai-validation.service';
import { ValidateFlightPlanDto } from './dto/validate-flight-plan.dto';
import type { ValidationResponse } from './dto/validation-response.dto';

@ApiTags('ai-validation')
@Controller('flight-plans')
@UseGuards(JwtAuthGuard)
export class AiValidationController {
  constructor(private readonly service: AiValidationService) {}

  @Post('validate')
  @ApiOperation({ summary: 'Validate a flight plan using AI' })
  async validate(
    @CurrentUser() user: User,
    @Body() dto: ValidateFlightPlanDto,
  ): Promise<ValidationResponse> {
    return this.service.validateFlightPlan(user.id, dto);
  }
}
