import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateSimBriefConnectionDto {
  @ApiProperty({ example: 'johndoe', description: 'SimBrief pilot ID (username)' })
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  pilotId!: string;
}
