import { Feather } from '@expo/vector-icons';
import { colors, Text } from '@fs-suite/ui';
import { usePathname, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { useCurrentUser } from '../../hooks/useCurrentUser';

import { isActive, NAV_ITEMS } from './navItems';

/**
 * Mobile navigation. Four equal cells, 56px tall so the hit target clears
 * 44px with room to spare. The active cell is marked by a 2px accent rule
 * along its top edge — the same language as the rail's left bar.
 */
export function BottomTabs(): JSX.Element {
  const { t } = useTranslation();
  const router = useRouter();
  const pathname = usePathname();
  const { user } = useCurrentUser();

  const items = NAV_ITEMS.filter(
    (i) => !i.desktopOnly && (!i.adminOnly || user?.isAdmin),
  );

  return (
    <View className="flex-row border-t-2 border-rule bg-background">
      {items.map((item) => {
        const active = isActive(pathname, item);
        return (
          <Pressable
            key={item.href}
            onPress={() => router.push(item.href as never)}
            className="flex-1 items-center justify-center active:bg-secondary"
            style={{ height: 56, paddingTop: 2 }}
            accessibilityRole="link"
            accessibilityState={{ selected: active }}
            accessibilityLabel={t(item.key)}
          >
            <View
              style={{ height: 2, width: '100%', marginTop: -2, marginBottom: 8 }}
              className={active ? 'bg-primary' : 'bg-transparent'}
            />
            <Feather
              name={item.icon}
              size={18}
              color={active ? colors.primary : colors.mutedForeground}
            />
            <Text
              variant="label"
              className={['mt-1 text-[10px]', active ? 'text-primary' : 'text-muted-foreground'].join(' ')}
            >
              {t(item.key)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
