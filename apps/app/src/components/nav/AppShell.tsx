import type { ReactNode } from 'react';
import { View } from 'react-native';

import { useIsDesktop } from '../../hooks/useIsDesktop';

import { BottomTabs } from './BottomTabs';
import { MobileTopBar } from './MobileTopBar';
import { NavRail } from './NavRail';

/**
 * One shell, two shapes. Desktop puts the rail beside the content; mobile
 * puts a slim brand bar above it and the tabs below. The routes and the
 * screens inside are untouched — this only decides what surrounds them.
 */
export function AppShell({ children }: { children: ReactNode }): JSX.Element {
  const isDesktop = useIsDesktop();

  if (isDesktop) {
    return (
      <View className="flex-1 flex-row bg-background">
        <NavRail />
        <View className="flex-1" style={{ minWidth: 0 }}>
          {children}
        </View>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-background">
      <MobileTopBar />
      <View className="flex-1" style={{ minWidth: 0 }}>
        {children}
      </View>
      <BottomTabs />
    </View>
  );
}
