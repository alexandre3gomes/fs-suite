import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

class RouteLegDto {
  @IsString() from!: string;
  @IsString() to!: string;
  @IsNumber() distanceNm!: number;
  @IsNumber() magneticCourse!: number;
}

export class ValidateFlightPlanDto {
  @ApiPropertyOptional() @IsOptional() @IsString() flightRules?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() originIcao?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() originName?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() originElevationFt?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() originMetarRaw?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() destinationIcao?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() destinationName?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() destinationElevationFt?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() destinationMetarRaw?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() alternateIcao?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() alternateName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() alternateMetarRaw?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() routeText?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() cruiseLevel?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() aircraftType?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() aircraftName?: string;

  @ApiPropertyOptional() @IsOptional() @IsNumber() takeoffWeightKg?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() mtowKg?: number;

  @ApiPropertyOptional() @IsOptional() @IsNumber() fuelCurrentTotal?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() fuelRequiredTotal?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() fuelConsumptionPerHour?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() fuelReserveMinutes?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() enduranceMinutes?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() tripFuelKg?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() altFuelKg?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() contingencyPercent?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() reserveFuelKg?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() minFuelKg?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() totalDistanceNm?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() tripMinutes?: number;

  @ApiPropertyOptional() @IsOptional() @IsString() flightCondition?: string;

  @ApiPropertyOptional({ type: [RouteLegDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RouteLegDto)
  routeLegs?: RouteLegDto[];

  @ApiPropertyOptional() @IsOptional() @IsString() remarks?: string;
}
