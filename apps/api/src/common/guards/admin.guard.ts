import { type CanActivate, type ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { User } from '@prisma/client';
import type { Request } from 'express';

import { isAdminEmail } from '../../auth/admin-emails';

/**
 * Requires the JWT-authenticated user to be an admin (see ADMIN_EMAILS).
 * Must run AFTER JwtAuthGuard, which populates `req.user`.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request & { user?: User }>();
    if (!isAdminEmail(req.user?.email)) {
      throw new ForbiddenException('Admin access required');
    }
    return true;
  }
}
