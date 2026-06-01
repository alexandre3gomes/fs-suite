import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { User } from '@prisma/client';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AdminGuard } from '../common/guards/admin.guard';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

import { SetUserAdminDto } from './dto/set-user-admin.dto';
import { type AdminUserView, UsersService } from './users.service';

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminGuard)
@SkipThrottle()
@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @ApiOperation({ summary: 'List all users' })
  list(): Promise<AdminUserView[]> {
    return this.users.listAll();
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Grant or revoke admin access' })
  setAdmin(
    @CurrentUser() me: User,
    @Param('id') id: string,
    @Body() dto: SetUserAdminDto,
  ): Promise<AdminUserView> {
    return this.users.setAdmin(id, dto.isAdmin, me.id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete a user' })
  async remove(@CurrentUser() me: User, @Param('id') id: string): Promise<void> {
    await this.users.adminDelete(id, me.id);
  }
}
