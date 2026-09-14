import { Feather } from '@expo/vector-icons';
import { Logo, Text, colors } from '@fs-suite/ui';
import { usePathname, useRouter } from 'expo-router';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { AccountBlock } from './AccountBlock';
import { NAV_ITEMS } from './navItems';

/**
 * Mobile chrome.
 *
 * The tab bar covers the four top-level routes. Everything deeper —
 * `flight-plans/[id]`, `flight-plans/new`, `admin/feedback/[id]`, the
 * aircraft-profile detail — has no tab, so this bar carries the back control
 * on those routes. Without it a phone user can reach those screens and have
 * no in-app way out (the defect in slice 1).
 *
 * On a top-level route the brand takes the same slot, so the bar never shifts
 * height between screens.
 */
export function MobileTopBar({ clock }: { clock?: string }): JSX.Element {
  const { t } = useTranslation();
  const router = useRouter();
  const pathname = usePathname();

  // Exact match against the tab-bar destinations only. A prefix match would
  // make every deeper route (`/flight-plans/new`, `/admin/users`) read as
  // top-level and suppress the back control — and `desktopOnly` items have no
  // tab on mobile, so they always need it.
  const isTopLevel = NAV_ITEMS.some(
    (item) => !item.desktopOnly && pathname === item.match,
  );

  const handleBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.push('/(auth)/dashboard' as never);
    }
  }, [router]);

  return (
    <View
      className="flex-row items-center justify-between border-b-2 border-rule bg-background px-4"
      style={{ height: 52 }}
    >
      {isTopLevel ? (
        <Logo height={20} />
      ) : (
        <Pressable
          onPress={handleBack}
          testID="mobile-back"
          hitSlop={12}
          className="flex-row items-center gap-2"
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
          // 44px minimum target, met by the row height plus hitSlop.
          style={{ minHeight: 44, justifyContent: 'center' }}
        >
          <Feather name="arrow-left" size={18} color={colors.foreground} />
          <Text variant="labelInk">{t('common.back')}</Text>
        </Pressable>
      )}
      <View className="flex-row items-center gap-3">
        {clock ? <Text variant="label">{clock}</Text> : null}
        <AccountBlock layout="bar" />
      </View>
    </View>
  );
}
