import { PartialType } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';

import { CreateFlightPlanDto } from './create-flight-plan.dto';

export class UpdateFlightPlanDto extends PartialType(CreateFlightPlanDto) {
  @IsOptional()
  @IsEnum(['DRAFT', 'COMPLETED', 'ARCHIVED'])
  status?: 'DRAFT' | 'COMPLETED' | 'ARCHIVED';
}
