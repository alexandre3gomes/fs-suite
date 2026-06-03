import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class ImportFplDto {
  @ApiProperty({ description: 'Garmin/SkyVector .fpl flight plan XML' })
  @IsString()
  @MinLength(20)
  @MaxLength(100_000) // generous for big routes; stays under the JSON body limit
  fpl!: string;
}
