import { ApiProperty } from '@nestjs/swagger';
import { FeedbackType } from '@prisma/client';
import { IsEnum, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateFeedbackDto {
  @ApiProperty({ enum: FeedbackType })
  @IsEnum(FeedbackType)
  type!: FeedbackType;

  @ApiProperty({ description: 'Free-text description of the bug or suggestion' })
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  description!: string;
}
