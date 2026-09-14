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
  /**
   * Full-width band above both columns. The step strip goes here, not inside
   * `sidebarContent`: the sidebar collapses so the pilot can work the map, and
   * navigation that disappears with it is navigation the pilot cannot reach.
   * It also gives the strip the whole width, so the step labels stop
   * truncating to "01 R…" in a 560px column.
   *
   * Kept as an opaque node so this layout stays ignorant of steps.
   */
  headerElement?: React.ReactNode;
}

/**
 * Modernist plan layout. Same resize behaviour as before — every hook,
 * PanResponder and ratio below is unchanged. What changed is that the form no
 * longer floats: it is a ruled column flush against the map, separated by a
 * 2px divider, with no radius, no margin and no shadow. Nothing floats, so
 * the map keeps its full area and the boundary reads as structure.
 */
export function VfrPlanLayout({ mapElement, sidebarContent, headerElement }: Props) {
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
      <View className="flex-1 bg-background">
        {headerElement}
        <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 80 }}>
          {sidebarContent(expand)}
        </ScrollView>
      </View>
    );
  }

  if (!isDesktop) {
    const currentMapHeight = mapHeight ?? defaultMapHeight;
    const formVisible = currentMapHeight < maxMap - 20;

    return (
      <View className="flex-1 bg-background">
        {headerElement}
        <View style={{ height: currentMapHeight }}>
          {mapElement}
        </View>
        {/* Drag handle — a 2px rule with an ink grip, not a floating pill. */}
        <View
          {...panResponder.panHandlers}
          className="border-y-2 border-rule bg-background"
          style={{
            height: HANDLE_HEIGHT,
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'row-resize',
          } as never}
        >
          <View className="bg-rule" style={{ width: 40, height: 3 }} />
        </View>
        {formVisible && (
          <View style={{ flex: 1 }} className="bg-background">
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
    <View className="flex-1 bg-background">
      {headerElement}

      {/* The split. Everything below the header resizes; the header does not. */}
      <View className="flex-1 flex-row">
        {sidebarMode !== 'collapsed' && (
          <View style={sidebarStyle} className="border-r-2 border-rule bg-background">
            <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 40 }}>
              {sidebarContent(expand)}
            </ScrollView>
          </View>
        )}

        <View style={{ flex: mapFlex, position: 'relative' }}>
          {mapElement}

          {/* Sidebar controls — square, ruled, flush to the map's left edge. */}
          <View
            className="border-2 border-l-0 border-rule bg-background"
            style={{ position: 'absolute', left: 0, top: 200, zIndex: 1000, overflow: 'hidden' }}
          >
            {sidebarMode === 'collapsed' ? (
              <Pressable onPress={normalize} style={{ paddingHorizontal: 7, paddingVertical: 14 }}>
                <Text className="font-sans text-[12px] font-bold text-foreground">❯</Text>
              </Pressable>
            ) : sidebarMode === 'normal' ? (
              <>
                <Pressable
                  onPress={expand}
                  className="border-b border-border"
                  style={{ paddingHorizontal: 7, paddingVertical: 10 }}
                >
                  <Text className="font-sans text-[10px] font-bold text-foreground">❯❯</Text>
                </Pressable>
                <Pressable onPress={collapse} style={{ paddingHorizontal: 7, paddingVertical: 10 }}>
                  <Text className="font-sans text-[12px] font-bold text-foreground">❮</Text>
                </Pressable>
              </>
            ) : (
              <Pressable onPress={normalize} style={{ paddingHorizontal: 7, paddingVertical: 14 }}>
                <Text className="font-sans text-[10px] font-bold text-foreground">❮❮</Text>
              </Pressable>
            )}
          </View>
        </View>
      </View>
    </View>
  );
}
