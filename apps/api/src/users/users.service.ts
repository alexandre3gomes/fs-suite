import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { User } from '@prisma/client';

import { ActivityService } from '../activity/activity.service';
import { isAdminEmail } from '../auth/admin-emails';
import { PrismaService } from '../prisma/prisma.service';

import type { UpdateUserDto } from './dto/update-user.dto';

/** Shape returned to the admin user-management area. */
export interface AdminUserView {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  createdAt: Date;
  isAdmin: boolean;
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityService,
  ) {}

  async findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { id, deletedAt: null },
    });
  }

  // --- Admin user management -------------------------------------------------

  /** All active users, newest first, with effective admin status. */
  async listAll(): Promise<AdminUserView[]> {
    const users = await this.prisma.user.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { id: true, email: true, name: true, avatarUrl: true, createdAt: true, isAdmin: true },
    });
    return users.map((u) => ({ ...u, isAdmin: u.isAdmin || isAdminEmail(u.email) }));
  }

  /** Grant or revoke admin. Self-demotion and demoting a bootstrap admin are blocked. */
  async setAdmin(id: string, isAdmin: boolean, actingUserId: string): Promise<AdminUserView> {
    const target = await this.prisma.user.findFirst({ where: { id, deletedAt: null } });
    if (!target) throw new NotFoundException('User not found');
    if (!isAdmin && id === actingUserId) {
      throw new ForbiddenException('You cannot revoke your own admin access');
    }
    if (!isAdmin && isAdminEmail(target.email)) {
      throw new ForbiddenException('This user is a bootstrap admin and cannot be demoted here');
    }
    const user = await this.prisma.user.update({ where: { id }, data: { isAdmin } });
    void this.activity.log(isAdmin ? 'admin.user.promote' : 'admin.user.demote', actingUserId, {
      targetUserId: id,
    });
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
      createdAt: user.createdAt,
      isAdmin: user.isAdmin || isAdminEmail(user.email),
    };
  }

  /** Soft-delete another user and invalidate their sessions. Cannot delete self here. */
  async adminDelete(id: string, actingUserId: string): Promise<void> {
    if (id === actingUserId) {
      throw new ForbiddenException('Use account deletion in your profile to delete your own account');
    }
    const target = await this.prisma.user.findFirst({ where: { id, deletedAt: null } });
    if (!target) throw new NotFoundException('User not found');
    await this.prisma.user.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.prisma.session.deleteMany({ where: { userId: id } });
    void this.activity.log('admin.user.delete', actingUserId, { targetUserId: id });
  }

  async updateMe(id: string, dto: UpdateUserDto): Promise<User> {
    const consentChanged = dto.marketingEmailConsent !== undefined;
    const user = await this.prisma.user.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(consentChanged && {
          marketingEmailConsent: dto.marketingEmailConsent,
          marketingEmailConsentUpdatedAt: new Date(),
        }),
      },
    });
    void this.activity.log('user.updated', id);
    if (consentChanged) {
      void this.activity.log(
        dto.marketingEmailConsent ? 'email.consent.opt_in' : 'email.consent.opt_out',
        id,
      );
    }
    return user;
  }

  async deleteMe(id: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    await this.prisma.user.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    // Invalidate all sessions
    await this.prisma.session.deleteMany({ where: { userId: id } });
    void this.activity.log('user.deleted', id);
  }
}
