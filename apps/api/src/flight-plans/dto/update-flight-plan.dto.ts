import { ApiPropertyOptional } from '@nestjs/swagger';
import { PartialType } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';

import { CreateFlightPlanDto } from './create-flight-plan.dto';

export class UpdateFlightPlanDto extends PartialType(CreateFlightPlanDto) {
  @ApiPropertyOptional({ enum: ['DRAFT', 'SAVED', 'ARCHIVED'] })
  @IsOptional()
  @IsEnum(['DRAFT', 'SAVED', 'ARCHIVED'])
  status?: 'DRAFT' | 'SAVED' | 'ARCHIVED';
}
