import type { Feather } from '@expo/vector-icons';
import type { ComponentProps } from 'react';

export type FeatherName = ComponentProps<typeof Feather>['name'];

export interface NavItem {
  /** i18n key for the label. */
  key: string;
  /** expo-router href. Unchanged from the existing routes. */
  href: string;
  /** Path prefix used to decide the active state. */
  match: string;
  icon: FeatherName;
  /** Hidden from the mobile tab bar (still reachable from the account menu). */
  desktopOnly?: boolean;
  adminOnly?: boolean;
}

/**
 * The whole app in one list. The rail (desktop) and the tab bar (mobile) both
 * read this, so wayfinding can't drift between the two.
 */
export const NAV_ITEMS: NavItem[] = [
  { key: 'nav.opsBoard', href: '/(auth)/dashboard', match: '/dashboard', icon: 'grid' },
  { key: 'nav.flightPlans', href: '/(auth)/flight-plans', match: '/flight-plans', icon: 'map' },
  { key: 'nav.aircraft', href: '/(auth)/aircraft-profiles', match: '/aircraft-profiles', icon: 'navigation' },
  { key: 'nav.profile', href: '/(auth)/profile', match: '/profile', icon: 'user' },
  { key: 'nav.admin', href: '/(auth)/admin', match: '/admin', icon: 'shield', desktopOnly: true, adminOnly: true },
];

export function isActive(pathname: string, item: NavItem): boolean {
  return pathname === item.match || pathname.startsWith(item.match + '/');
}
