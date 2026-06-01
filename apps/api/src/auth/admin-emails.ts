/**
 * Bootstrap admin allow-list. Admin access is normally the persisted
 * `User.isAdmin` flag (toggled from the in-app user management area), but any
 * email listed here is ALWAYS an admin — a safety net so the instance can never
 * be locked out of its own admin area. Compared case-insensitively.
 */
export const ADMIN_EMAILS: readonly string[] = [
  'alexandre3gomes@gmail.com',
];

export function isAdminEmail(email: string | null | undefined): boolean {
  return !!email && ADMIN_EMAILS.includes(email.trim().toLowerCase());
}

/** Effective admin status: the persisted flag OR the bootstrap allow-list. */
export function isUserAdmin(
  user: { email?: string | null; isAdmin?: boolean } | null | undefined,
): boolean {
  return !!user && (user.isAdmin === true || isAdminEmail(user.email));
}
