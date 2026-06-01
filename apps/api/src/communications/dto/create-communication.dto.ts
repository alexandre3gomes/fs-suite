import { ApiProperty } from '@nestjs/swagger';
import { CommunicationType } from '@prisma/client';
import { IsEnum, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateCommunicationDto {
  @ApiProperty({ enum: CommunicationType })
  @IsEnum(CommunicationType)
  type!: CommunicationType;

  @ApiProperty({ maxLength: 150 })
  @IsString()
  @MinLength(3)
  @MaxLength(150)
  subject!: string;

  @ApiProperty({ description: 'Markdown body', maxLength: 20000 })
  @IsString()
  @MinLength(1)
  @MaxLength(20000)
  body!: string;
}
