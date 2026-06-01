import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class SetUserAdminDto {
  @ApiProperty({ description: 'Whether the user should have admin access' })
  @IsBoolean()
  isAdmin!: boolean;
}
