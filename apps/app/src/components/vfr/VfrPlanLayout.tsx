import { useCallback, useMemo, useRef, useState } from 'react';
import { PanResponder, Platform, Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native';

import { useIsDesktop } from '../../hooks/useIsDesktop';

type SidebarMode = 'collapsed' | 'normal' | 'expanded';

const HANDLE_HEIGHT = 20;
const MIN_MAP_RATIO = 0.15;
const MAX_MAP_RATIO = 0.85;

interface Props {
  mapElement: React.ReactNode;
  sidebarContent: (onRequestExpand: () => void) => React.ReactNode;
}

export function VfrPlanLayout({ mapElement, sidebarContent }: Props) {
  const isDesktop = useIsDesktop();
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>('normal');
  const [mapHeight, setMapHeight] = useState<number | null>(null);
  const dragStartHeight = useRef(0);

  const minMap = Math.round(windowHeight * MIN_MAP_RATIO);
  const maxMap = Math.round(windowHeight * MAX_MAP_RATIO);
  const defaultMapHeight = Math.round(windowHeight * 0.33);

  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_e, gs) => Math.abs(gs.dy) > 4,
    onPanResponderGrant: () => {
      dragStartHeight.current = mapHeight ?? defaultMapHeight;
    },
    onPanResponderMove: (_e, gs) => {
      const next = Math.max(minMap, Math.min(maxMap, dragStartHeight.current + gs.dy));
      setMapHeight(next);
    },
    onPanResponderRelease: (_e, gs) => {
      const final = Math.max(minMap, Math.min(maxMap, dragStartHeight.current + gs.dy));
      setMapHeight(final);
      if (final > windowHeight * 0.6) {
        setSidebarMode('collapsed');
      } else if (final < windowHeight * 0.28) {
        setSidebarMode('expanded');
      } else {
        setSidebarMode('normal');
      }
    },
  }), [mapHeight, defaultMapHeight, minMap, maxMap, windowHeight]);

  const collapse = useCallback(() => {
    setSidebarMode('collapsed');
    setMapHeight(Math.round(windowHeight * 0.7));
  }, [windowHeight]);
  const normalize = useCallback(() => {
    setSidebarMode('normal');
    setMapHeight(null);
  }, []);
  const expand = useCallback(() => {
    setSidebarMode('expanded');
    setMapHeight(Math.round(windowHeight * 0.25));
  }, [windowHeight]);

  if (Platform.OS !== 'web') {
    return (
      <ScrollView className="flex-1 bg-background" contentContainerStyle={{ paddingBottom: 80 }}>
        {sidebarContent(expand)}
      </ScrollView>
    );
  }

  if (!isDesktop) {
    const currentMapHeight = mapHeight ?? defaultMapHeight;
    const formVisible = currentMapHeight < maxMap - 20;

    return (
      <View className="flex-1 bg-background">
        <View style={{ height: currentMapHeight }}>
          {mapElement}
        </View>
        {/* Drag handle */}
        <View
          {...panResponder.panHandlers}
          style={{
            height: HANDLE_HEIGHT,
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'row-resize',
          } as never}
        >
          <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: '#d1d5db' }} />
        </View>
        {formVisible && (
          <View style={{ flex: 1, marginHorizontal: 8, marginBottom: 8, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.97)', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 8, elevation: 8, overflow: 'hidden' }}>
            <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 80 }}>
              {sidebarContent(expand)}
            </ScrollView>
          </View>
        )}
      </View>
    );
  }

  const sidebarNormalWidth = Math.min(400, Math.round(windowWidth * 0.35));
  const sidebarStyle =
    sidebarMode === 'normal'
      ? { width: sidebarNormalWidth }
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
