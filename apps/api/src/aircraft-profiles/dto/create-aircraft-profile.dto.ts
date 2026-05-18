import type { CreateAircraftProfileInput, WeightStation } from '@fs-suite/types';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Allow } from 'class-validator';

export class WeightStationDto implements WeightStation {
  @ApiProperty() id!: string;
  @ApiProperty() labelKey!: string;
  @ApiProperty() defaultKg!: number;
  @ApiProperty() maxKg!: number;
  @ApiProperty() arm!: number;
}

export class CreateAircraftProfileDto implements CreateAircraftProfileInput {
  @ApiProperty({ example: 'Cessna 172S Skyhawk SP' })
  @Allow()
  name!: string;

  @ApiPropertyOptional({ example: 'C172' }) @Allow() icaoType?: string;
  @ApiPropertyOptional() @Allow() manufacturer?: string;
  @ApiPropertyOptional() @Allow() model?: string;
  @ApiPropertyOptional() @Allow() emptyWeightKg?: number;
  @ApiPropertyOptional() @Allow() mtowKg?: number;
  @ApiPropertyOptional() @Allow() fuelCapacityL?: number;
  @ApiPropertyOptional() @Allow() fuelBurnLph?: number;
  @ApiPropertyOptional() @Allow() cruiseSpeedKts?: number;
  @ApiPropertyOptional({ type: [WeightStationDto] }) @Allow() stations?: WeightStationDto[];
}
