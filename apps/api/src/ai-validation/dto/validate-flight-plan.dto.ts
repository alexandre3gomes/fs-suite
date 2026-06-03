import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

class RouteLegDto {
  @IsString() from!: string;
  @IsString() to!: string;
  @IsNumber() distanceNm!: number;
  @IsNumber() trueCourse!: number;
  @IsNumber() magneticDeclination!: number;
  @IsNumber() magneticCourse!: number;
  @IsOptional() @IsArray() suggestedAltitudes?: number[];
  @IsOptional() @IsNumber() timeMin?: number;
  @IsOptional() @IsNumber() groundSpeedKts?: number;
  @IsOptional() @IsNumber() magneticHeading?: number;
  @IsOptional() @IsNumber() selectedAltitudeFt?: number;
}

class AltitudeChangeDto {
  @IsString() atWaypoint!: string;
  @IsNumber() toAltFt!: number;
}

class VisualReferenceDto {
  @IsInt() sequence!: number;
  @IsString() name!: string;
  @IsOptional() @IsNumber() distanceNm?: number;
  @IsOptional() @IsInt() timeMin?: number;
}

class RunwayDto {
  @IsString() ident!: string;
  @IsOptional() @IsNumber() headingDeg?: number | null;
  @IsOptional() @IsNumber() lengthFt?: number | null;
}

class AircraftStationDto {
  @IsString() id!: string;
  @IsString() labelKey!: string;
  @IsNumber() maxKg!: number;
  @IsNumber() arm!: number;
}

class ReaSegmentDto {
  @IsString() from!: string;
  @IsString() to!: string;
  @IsNumber() altMin!: number;
  @IsNumber() altMax!: number;
  @IsOptional() @IsNumber() altComp?: number | null;
}

class ReaCorridorDto {
  @IsString() regionName!: string;
  @IsString() corridorName!: string;
  @IsString() tipo!: string;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => ReaSegmentDto) segments?: ReaSegmentDto[];
}

export class ValidateFlightPlanDto {
  @ApiPropertyOptional() @IsOptional() @IsString() flightRules?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() originIcao?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() originName?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() originElevationFt?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() originLatitude?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() originLongitude?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() originRunwayInUse?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() originMetarRaw?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() originTafRaw?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() destinationIcao?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() destinationName?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() destinationElevationFt?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() destinationLatitude?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() destinationLongitude?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() destinationRunwayInUse?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() destinationMetarRaw?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() destinationTafRaw?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() destinationTpaFt?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() destinationTpaSource?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() alternateIcao?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() alternateName?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() alternateElevationFt?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() alternateLatitude?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() alternateLongitude?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() alternateRunwayInUse?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() alternateMetarRaw?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() alternateTafRaw?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() alternatePlannedAltitude?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() alternateRouteText?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsArray()
  alternateRouteWaypoints?: { lat: number; lng: number; name: string }[];

  @ApiPropertyOptional({ type: [RunwayDto] })
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => RunwayDto)
  originRunways?: RunwayDto[];

  @ApiPropertyOptional({ type: [RunwayDto] })
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => RunwayDto)
  destinationRunways?: RunwayDto[];

  @ApiPropertyOptional({ type: [RunwayDto] })
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => RunwayDto)
  alternateRunways?: RunwayDto[];

  @ApiPropertyOptional({ type: [ReaCorridorDto] })
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => ReaCorridorDto)
  reaCorridors?: ReaCorridorDto[];

  @ApiPropertyOptional() @IsOptional() @IsString() routeText?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() cruiseLevel?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() todMinutes?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() todDistanceNm?: number;

  @ApiPropertyOptional() @IsOptional() @IsString() aircraftType?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() aircraftName?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() cruiseSpeedKts?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() fuelBurnLph?: number;

  @ApiPropertyOptional({ type: [AircraftStationDto] })
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => AircraftStationDto)
  stations?: AircraftStationDto[];

  @ApiPropertyOptional() @IsOptional() @IsNumber() takeoffWeightKg?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() mtowKg?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() emptyWeightKg?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() payloadKg?: number;

  @ApiPropertyOptional() @IsOptional() @IsNumber() fuelCurrentTotal?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() fuelRequiredTotal?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() fuelConsumptionPerHour?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() fuelReserveMinutes?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() fuelPerWing?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() fuelCapacityL?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() enduranceMinutes?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() tripFuelKg?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() altFuelKg?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() altDistanceNm?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() contingencyPct?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() contingencyFuelKg?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() reserveFuelKg?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() minFuelKg?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() totalDistanceNm?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() tripMinutes?: number;

  @ApiPropertyOptional() @IsOptional() @IsString() flightCondition?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() callsign?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() simbriefOfpId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() status?: string;

  @ApiPropertyOptional({ type: [RouteLegDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RouteLegDto)
  routeLegs?: RouteLegDto[];

  @ApiPropertyOptional({ type: [VisualReferenceDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VisualReferenceDto)
  visualReferences?: VisualReferenceDto[];

  @ApiPropertyOptional() @IsOptional() @IsString() remarks?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() performanceCategory?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() item18Text?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() registration?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() plannedDepartureTime?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsArray()
  routeWaypoints?: { lat: number; lng: number; name: string }[];

  @ApiPropertyOptional({ type: [AltitudeChangeDto] })
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => AltitudeChangeDto)
  altitudeChanges?: AltitudeChangeDto[];
}
