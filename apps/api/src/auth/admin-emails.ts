/**
 * Hard-coded admin allow-list. Admin status is derived from the authenticated
 * user's email — there is NO DB column. Add an email here to grant access to
 * the in-app Admin area (e.g. Communications). Compared case-insensitively.
 */
export const ADMIN_EMAILS: readonly string[] = [
  'alexandre3gomes@gmail.com',
];

export function isAdminEmail(email: string | null | undefined): boolean {
  return !!email && ADMIN_EMAILS.includes(email.trim().toLowerCase());
}
