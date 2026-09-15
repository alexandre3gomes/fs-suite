import { Feather } from '@expo/vector-icons';
import { Logo, Text } from '@fs-suite/ui';
import { colors } from '@fs-suite/ui';
import { usePathname, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable, View } from 'react-native';

import { useCurrentUser } from '../../hooks/useCurrentUser';

import { AccountBlock } from './AccountBlock';
import { isActive, NAV_ITEMS } from './navItems';

const RAIL_WIDTH = 232;

/**
 * Desktop navigation. A persistent rail replaces the old back-button-only
 * header: every destination is visible and the active one is marked by an
 * accent bar at the left edge, flush with the label.
 */
export function NavRail(): JSX.Element {
  const { t } = useTranslation();
  const router = useRouter();
  const pathname = usePathname();
  const { user } = useCurrentUser();

  const items = NAV_ITEMS.filter((i) => !i.adminOnly || user?.isAdmin);

  return (
    <View
      className="border-r-2 border-rule bg-background"
      style={{ width: RAIL_WIDTH, flexBasis: RAIL_WIDTH, flexGrow: 0, flexShrink: 0 }}
    >
      <View className="border-b-2 border-rule px-6 py-5">
        <Logo height={28} />
      </View>

      <View>
        {items.map((item) => {
          const active = isActive(pathname, item);
          return (
            <Pressable
              key={item.href}
              onPress={() => router.push(item.href as never)}
              className={[
                'flex-row items-center gap-3 border-b border-border py-3 pr-4',
                active ? 'bg-secondary' : '',
                Platform.OS === 'web' ? 'transition-colors hover:bg-secondary' : 'active:bg-secondary',
              ].join(' ')}
              style={Platform.OS === 'web' ? ({ cursor: 'pointer' } as never) : undefined}
              accessibilityRole="link"
              accessibilityState={{ selected: active }}
            >
              {/* Active marker: a 4px accent bar in the left gutter. */}
              <View
                style={{ width: 4, alignSelf: 'stretch', minHeight: 20 }}
                className={active ? 'bg-primary' : 'bg-transparent'}
              />
              <Feather
                name={item.icon}
                size={16}
                color={active ? colors.primary : colors.mutedForeground}
              />
              <Text
                variant="labelInk"
                className={['text-[13px]', active ? 'text-primary' : 'text-foreground'].join(' ')}
              >
                {t(item.key)}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View className="mt-auto border-t-2 border-rule">
        <AccountBlock layout="rail" />
      </View>
    </View>
  );
}

export { RAIL_WIDTH };
