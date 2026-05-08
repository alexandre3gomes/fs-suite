import { PartialType } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';

import { CreateVfrFlightPlanDto } from './create-vfr-flight-plan.dto';

export class UpdateVfrFlightPlanDto extends PartialType(CreateVfrFlightPlanDto) {
  @IsOptional()
  @IsEnum(['DRAFT', 'COMPLETED'])
  status?: 'DRAFT' | 'COMPLETED';
}
