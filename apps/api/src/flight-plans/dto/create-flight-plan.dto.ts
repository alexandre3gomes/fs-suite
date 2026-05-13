import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class RouteWaypointDto {
  @ApiProperty({ example: 0 }) @IsInt() @Min(0) sequence!: number;
  @ApiProperty({ example: 'ERNAS' }) @IsString() @MinLength(1) @MaxLength(10) waypointIdent!: string;
  @ApiPropertyOptional({ example: -23.43 }) @IsOptional() @IsNumber() latitude?: number;
  @ApiPropertyOptional({ example: -46.47 }) @IsOptional() @IsNumber() longitude?: number;
  @ApiPropertyOptional({ example: 'UW2' }) @IsOptional() @IsString() @MaxLength(10) airway?: string;
}

export class VisualReferenceDto {
  @ApiProperty() @IsInt() @Min(0) sequence!: number;
  @ApiProperty() @IsString() @MaxLength(200) name!: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() distanceNm?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) timeMin?: number;
}

export class BriefingItemDto {
  @ApiProperty() @IsString() @MaxLength(50) code!: string;
  @ApiProperty() @IsString() @MaxLength(200) label!: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() checked?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

export class CreateFlightPlanDto {
  // Flight rules
  @ApiPropertyOptional({ enum: ['VFR', 'IFR', 'VFR_IFR', 'IFR_VFR'] })
  @IsOptional()
  @IsEnum(['VFR', 'IFR', 'VFR_IFR', 'IFR_VFR'])
  flightRules?: 'VFR' | 'IFR' | 'VFR_IFR' | 'IFR_VFR';

  // Origin (required)
  @ApiProperty() @IsString() originIcao!: string;
  @ApiProperty() @IsString() originName!: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() originElevationFt?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() originRunwayInUse?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() originMetarRaw?: string;

  // Destination (required)
  @ApiProperty() @IsString() destinationIcao!: string;
  @ApiProperty() @IsString() destinationName!: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() destinationElevationFt?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() destinationRunwayInUse?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() destinationMetarRaw?: string;

  // Alternate (optional)
  @ApiPropertyOptional() @IsOptional() @IsString() alternateIcao?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() alternateName?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() alternateElevationFt?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() alternateRunwayInUse?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() alternateMetarRaw?: string;

  // Aircraft
  @ApiPropertyOptional() @IsOptional() @IsString() aircraftType?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() aircraftName?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() takeoffWeightKg?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() mtowKg?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) callsign?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) simbriefOfpId?: string;

  // Route
  @ApiPropertyOptional() @IsOptional() @IsString() routeText?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(/^(FL\d{2,3}|[AF]\d{3}|\d{3,5})$/, {
    message: 'cruiseLevel must be FL045, A045, F045, or altitude in feet (e.g. 4500)',
  })
  cruiseLevel?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) plannedAltitude?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) remarks?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) todMinutes?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) todDistanceNm?: number;

  // Fuel
  @ApiPropertyOptional() @IsOptional() @IsNumber() fuelConsumptionPerHour?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() fuelCurrentTotal?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() fuelReserveMinutes?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() fuelRequiredTotal?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() fuelPerWing?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) enduranceMinutes?: number;

  // Routes (IFR waypoints)
  @ApiPropertyOptional({ type: [RouteWaypointDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RouteWaypointDto)
  routes?: RouteWaypointDto[];

  // Visual references (VFR)
  @ApiPropertyOptional({ type: [VisualReferenceDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VisualReferenceDto)
  visualReferences?: VisualReferenceDto[];

  // Briefing items
  @ApiPropertyOptional({ type: [BriefingItemDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BriefingItemDto)
  briefingItems?: BriefingItemDto[];
}
