import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { User } from '@prisma/client';
import type { Response } from 'express';

import { isAdminEmail } from '../auth/admin-emails';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

import { UpdateUserDto } from './dto/update-user.dto';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @ApiOperation({ summary: 'Get authenticated user profile' })
  getMe(@CurrentUser() user: User): User & { isAdmin: boolean } {
    return { ...user, isAdmin: isAdminEmail(user.email) };
  }

  @Patch('me')
  @ApiOperation({ summary: 'Update name or preferences' })
  async updateMe(
    @CurrentUser() user: User,
    @Body() dto: UpdateUserDto,
  ): Promise<User> {
    return this.usersService.updateMe(user.id, dto);
  }

  @Delete('me')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Request account deletion (LGPD)' })
  async deleteMe(
    @CurrentUser() user: User,
    @Res() res: Response,
  ): Promise<void> {
    await this.usersService.deleteMe(user.id);
    res.clearCookie('refresh_token');
    res.status(HttpStatus.NO_CONTENT).send();
  }
}
