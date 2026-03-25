import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class RouteWaypointDto {
  @ApiProperty({ example: 0 })
  @IsInt()
  @Min(0)
  sequence!: number;

  @ApiProperty({ example: 'ERNAS' })
  @IsString()
  @MinLength(1)
  @MaxLength(10)
  waypointIdent!: string;

  @ApiPropertyOptional({ example: -23.43 })
  @IsOptional()
  latitude?: number;

  @ApiPropertyOptional({ example: -46.47 })
  @IsOptional()
  longitude?: number;

  @ApiPropertyOptional({ example: 'UW2' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  airway?: string;
}

export class CreateFlightPlanDto {
  @ApiProperty({ enum: ['VFR', 'IFR'] })
  @IsEnum(['VFR', 'IFR'])
  flightType!: 'VFR' | 'IFR';

  @ApiProperty({ example: 'SBGR' })
  @IsString()
  @MinLength(3)
  @MaxLength(4)
  originIcao!: string;

  @ApiProperty({ example: 'SBSP' })
  @IsString()
  @MinLength(3)
  @MaxLength(4)
  destinationIcao!: string;

  @ApiPropertyOptional({ example: 35000 })
  @IsOptional()
  @IsInt()
  @Min(1)
  plannedAltitude?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  remarks?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  aircraftProfileId?: string;

  @ApiPropertyOptional({ type: [RouteWaypointDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RouteWaypointDto)
  routes?: RouteWaypointDto[];
}
