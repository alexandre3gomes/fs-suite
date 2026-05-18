import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class WeightStationDto {
  @ApiProperty() @IsString() id!: string;
  @ApiProperty() @IsString() labelKey!: string;
  @ApiProperty() @IsNumber() defaultKg!: number;
  @ApiProperty() @IsNumber() maxKg!: number;
  @ApiProperty() @IsNumber() arm!: number;
}

export class CreateAircraftProfileDto {
  @ApiProperty({ example: 'Cessna 172S Skyhawk SP' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @ApiPropertyOptional({ example: 'C172' })
  @IsOptional()
  @IsString()
  @MaxLength(4)
  icaoType?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50) manufacturer?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) model?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() emptyWeightKg?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() mtowKg?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() fuelCapacityL?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() fuelBurnLph?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) cruiseSpeedKts?: number;

  @ApiPropertyOptional({ type: [WeightStationDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WeightStationDto)
  stations?: WeightStationDto[];
}
