import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class ReplyFeedbackDto {
  @ApiProperty({ description: 'Admin reply emailed to the reporter' })
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  message!: string;
}
