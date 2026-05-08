import { useCallback, useState } from 'react';
import { Platform, Pressable, ScrollView, Text, View } from 'react-native';

import { useIsDesktop } from '../../hooks/useIsDesktop';

const SIDEBAR_NORMAL_WIDTH = 400;
const MOBILE_MAP_HEIGHT = 280;

type SidebarMode = 'collapsed' | 'normal' | 'expanded';

interface Props {
  mapElement: React.ReactNode;
  sidebarContent: (onRequestExpand: () => void) => React.ReactNode;
}

export function VfrPlanLayout({ mapElement, sidebarContent }: Props) {
  const isDesktop = useIsDesktop();
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>('normal');

  const collapse = useCallback(() => setSidebarMode('collapsed'), []);
  const normalize = useCallback(() => setSidebarMode('normal'), []);
  const expand = useCallback(() => setSidebarMode('expanded'), []);

  if (Platform.OS !== 'web') {
    return (
      <ScrollView className="flex-1 bg-background" contentContainerStyle={{ paddingBottom: 80 }}>
        {sidebarContent(expand)}
      </ScrollView>
    );
  }

  if (!isDesktop) {
    return (
      <View className="flex-1 bg-background">
        <View style={{ height: MOBILE_MAP_HEIGHT }}>
          {mapElement}
        </View>
        <View style={{ flex: 1, margin: 8, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.97)', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 8, elevation: 8, overflow: 'hidden' }}>
          <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 80 }}>
            {sidebarContent(expand)}
          </ScrollView>
        </View>
      </View>
    );
  }

  const sidebarStyle =
    sidebarMode === 'normal'
      ? { width: SIDEBAR_NORMAL_WIDTH }
      : { flex: 3 };

  const mapFlex = sidebarMode === 'expanded' ? 2 : 1;

  return (
    <View className="flex-1 flex-row bg-background">
      {sidebarMode !== 'collapsed' && (
        <View style={{ ...sidebarStyle, margin: 8, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.97)', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 12, elevation: 8, overflow: 'hidden' }}>
          <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 40 }}>
            {sidebarContent(expand)}
          </ScrollView>
        </View>
      )}

      <View style={{ flex: mapFlex, position: 'relative' }}>
        {mapElement}

        {/* Sidebar controls */}
        <View
          style={{
            position: 'absolute',
            left: 0,
            top: 200,
            zIndex: 1000,
            backgroundColor: 'rgba(255,255,255,0.92)',
            borderTopRightRadius: 6,
            borderBottomRightRadius: 6,
            borderWidth: 1,
            borderLeftWidth: 0,
            borderColor: 'rgba(128,128,128,0.25)',
            overflow: 'hidden',
          }}
        >
          {sidebarMode === 'collapsed' ? (
            <Pressable onPress={normalize} style={{ paddingHorizontal: 5, paddingVertical: 14 }}>
              <Text style={{ fontSize: 12, color: '#374151', fontWeight: '600' }}>❯</Text>
            </Pressable>
          ) : sidebarMode === 'normal' ? (
            <>
              <Pressable onPress={expand} style={{ paddingHorizontal: 5, paddingVertical: 10, borderBottomWidth: 1, borderColor: 'rgba(128,128,128,0.15)' }}>
                <Text style={{ fontSize: 10, color: '#374151', fontWeight: '600' }}>❯❯</Text>
              </Pressable>
              <Pressable onPress={collapse} style={{ paddingHorizontal: 5, paddingVertical: 10 }}>
                <Text style={{ fontSize: 12, color: '#374151', fontWeight: '600' }}>❮</Text>
              </Pressable>
            </>
          ) : (
            <Pressable onPress={normalize} style={{ paddingHorizontal: 5, paddingVertical: 14 }}>
              <Text style={{ fontSize: 10, color: '#374151', fontWeight: '600' }}>❮❮</Text>
            </Pressable>
          )}
        </View>
      </View>
    </View>
  );
}
