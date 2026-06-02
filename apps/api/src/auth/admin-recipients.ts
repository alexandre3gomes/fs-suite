import type { PrismaService } from '../prisma/prisma.service';

import { ADMIN_EMAILS } from './admin-emails';

/**
 * Effective admin email recipients: the union of persisted admins
 * (`User.isAdmin`, not soft-deleted) and the bootstrap `ADMIN_EMAILS`
 * allow-list, deduped case-insensitively. Single source of truth for
 * operational mail addressed to admins (metrics digest, feedback
 * notifications) — these are operational, so marketing consent does not apply.
 */
export async function getAdminRecipients(prisma: PrismaService): Promise<string[]> {
  const adminUsers = await prisma.user.findMany({
    where: { isAdmin: true, deletedAt: null },
    select: { email: true },
  });
  // ADMIN_EMAILS is already lowercase.
  return Array.from(
    new Set([...adminUsers.map((u) => u.email.trim().toLowerCase()), ...ADMIN_EMAILS]),
  );
}
