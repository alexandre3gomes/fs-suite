import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsString, MaxLength, MinLength } from 'class-validator';

export class SaveAiKeyDto {
  @ApiProperty({ enum: ['openai', 'anthropic', 'google'] })
  @IsEnum(['openai', 'anthropic', 'google'])
  provider!: 'openai' | 'anthropic' | 'google';

  @ApiProperty({ description: 'API key for the selected provider' })
  @IsString()
  @MinLength(10)
  @MaxLength(200)
  apiKey!: string;
}
