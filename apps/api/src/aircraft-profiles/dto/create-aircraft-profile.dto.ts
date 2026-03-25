import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';

export class CreateAircraftProfileDto {
  @ApiProperty({ example: 'Boeing 737-800' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @ApiPropertyOptional({ example: 'B738' })
  @IsOptional()
  @IsString()
  @MaxLength(4)
  icaoType?: string;

  @ApiPropertyOptional({ example: 460 })
  @IsOptional()
  @IsInt()
  @Min(1)
  cruiseSpeed?: number;

  @ApiPropertyOptional({ enum: ['kg', 'lbs', 'liters'] })
  @IsOptional()
  @IsString()
  @IsEnum(['kg', 'lbs', 'liters'])
  fuelUnit?: string;
}
