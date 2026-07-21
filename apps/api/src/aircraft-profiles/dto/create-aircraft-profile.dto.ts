import type { CreateAircraftProfileInput, WeightStation } from '@fs-suite/types';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
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

  @ApiProperty({ example: 'C172' }) @Allow() icaoType!: string;
  @ApiPropertyOptional() @Allow() manufacturer?: string;
  @ApiPropertyOptional() @Allow() model?: string;
  @ApiPropertyOptional() @Allow() emptyWeightKg?: number;
  @ApiPropertyOptional() @Allow() mtowKg?: number;
  @ApiPropertyOptional() @Allow() fuelCapacityL?: number;
  @ApiPropertyOptional() @Allow() fuelBurnLph?: number;
  @ApiPropertyOptional() @Allow() cruiseSpeedKts?: number;
  @ApiPropertyOptional() @Allow() climbSpeedKts?: number;
  @ApiPropertyOptional() @Allow() climbRateFpm?: number;
  @ApiPropertyOptional() @Allow() descentSpeedKts?: number;
  @ApiPropertyOptional() @Allow() descentRateFpm?: number;
  @ApiPropertyOptional() @Allow() isShared?: boolean;
  @ApiPropertyOptional({ type: [WeightStationDto] }) @Allow() @Type(() => WeightStationDto) stations?: WeightStationDto[];
}
