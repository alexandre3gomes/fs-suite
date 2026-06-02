import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateUserDto {
  @ApiPropertyOptional({ description: 'Display name', maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ description: 'Opt in/out of product announcement emails' })
  @IsOptional()
  @IsBoolean()
  marketingEmailConsent?: boolean;

  @ApiPropertyOptional({ description: 'UI language (e.g. pt-BR, en)', maxLength: 16 })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  locale?: string;
}
