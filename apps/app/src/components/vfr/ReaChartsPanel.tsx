import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable, ScrollView, Text, View } from 'react-native';

import { API_URL, apiClient } from '../../services/api.client';

interface ReaRegionInfo {
  regionId: string;
  chartName: string;
  chartPdfUrl: string;
}

interface Props {
  highlightRegionIds?: string[];
}

function getDoc(): any {
  return (globalThis as any).document;
}

const AISWEB_HOST = 'aisweb.decea.mil.br';

function viewerUrl(chartUrl: string): string {
  try {
    const host = new URL(chartUrl).hostname;
    if (host === AISWEB_HOST) return chartUrl;
  } catch { /* fall through to proxy */ }
  return `${API_URL}/v1/aerodromes/chart-proxy?url=${encodeURIComponent(chartUrl)}`;
}

const VIEWER_HEIGHT = 450;

export function ReaChartsPanel({ highlightRegionIds = [] }: Props) {
  const { t } = useTranslation();
  const [regions, setRegions] = useState<ReaRegionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [maximized, setMaximized] = useState(false);
  const iframeRef = useRef<View>(null);
  const overlayRef = useRef<any>(null);

  const highlightSet = new Set(highlightRegionIds);

  useEffect(() => {
    setLoading(true);
    void apiClient
      .get<ReaRegionInfo[]>('/rea/regions')
      .then((data) => {
        const withUrls = data.filter((r: ReaRegionInfo) => r.chartPdfUrl);
        setRegions(withUrls);
        if (withUrls.length > 0) {
          const firstHighlight = withUrls.findIndex((r: ReaRegionInfo) => highlightSet.has(r.regionId));
          setSelectedIdx(firstHighlight >= 0 ? firstHighlight : null);
        }
      })
      .catch(() => setRegions([]))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedRegion = selectedIdx !== null ? regions[selectedIdx] : undefined;

  // Render inline iframe
  useEffect(() => {
    if (Platform.OS !== 'web' || !iframeRef.current || !selectedRegion) return;
    const doc = getDoc();
    if (!doc) return;
    const el = iframeRef.current as any;
    el.innerHTML = '';
    const iframe = doc.createElement('iframe');
    iframe.src = viewerUrl(selectedRegion.chartPdfUrl);
    iframe.style.cssText = 'width:100%;height:100%;border:none;';
    iframe.title = selectedRegion.chartName;
    el.appendChild(iframe);
  }, [selectedRegion]);

  // Maximized overlay
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const doc = getDoc();
    if (!doc) return;

    if (!maximized || !selectedRegion) {
      if (overlayRef.current) {
        doc.body.removeChild(overlayRef.current);
        overlayRef.current = null;
      }
      return;
    }

    const overlay = doc.createElement('div');
    overlay.style.cssText =
      'position:fixed;top:0;left:0;right:0;bottom:0;z-index:9999;background:rgba(0,0,0,0.95);display:flex;flex-direction:column;';

    const header = doc.createElement('div');
    header.style.cssText =
      'display:flex;align-items:center;gap:8px;padding:10px 16px;border-bottom:1px solid rgba(255,255,255,0.1);';

    if (regions.length > 1) {
      const chipsWrap = doc.createElement('div');
      chipsWrap.style.cssText = 'display:flex;gap:6px;flex:1;overflow-x:auto;';
      regions.forEach((r: ReaRegionInfo, idx: number) => {
        const chip = doc.createElement('button');
        const active = idx === selectedIdx;
        const highlighted = highlightSet.has(r.regionId);
        chip.style.cssText =
          'padding:4px 10px;border-radius:4px;cursor:pointer;white-space:nowrap;font-size:11px;font-weight:600;' +
          `border:1px solid ${active ? 'rgba(96,165,250,0.6)' : highlighted ? 'rgba(239,68,68,0.4)' : 'rgba(255,255,255,0.2)'};` +
          `background:${active ? 'rgba(96,165,250,0.15)' : highlighted ? 'rgba(239,68,68,0.08)' : 'transparent'};` +
          `color:${active ? '#93c5fd' : highlighted ? '#fca5a5' : 'rgba(255,255,255,0.7)'};`;
        chip.textContent = r.chartName;
        chip.onclick = () => setSelectedIdx(idx);
        chipsWrap.appendChild(chip);
      });
      header.appendChild(chipsWrap);
    } else if (selectedRegion) {
      const title = doc.createElement('span');
      title.style.cssText = 'color:#fff;font-size:13px;font-weight:600;flex:1;';
      title.textContent = selectedRegion.chartName;
      header.appendChild(title);
    }

    const extBtn = doc.createElement('button');
    extBtn.style.cssText =
      'background:none;border:1px solid rgba(255,255,255,0.2);color:rgba(255,255,255,0.7);font-size:12px;cursor:pointer;padding:4px 10px;border-radius:4px;flex-shrink:0;';
    extBtn.textContent = '↗';
    extBtn.title = 'Open in new tab';
    extBtn.onclick = () => (globalThis as any).window?.open(selectedRegion!.chartPdfUrl, '_blank');
    header.appendChild(extBtn);

    const closeBtn = doc.createElement('button');
    closeBtn.style.cssText =
      'background:none;border:1px solid rgba(255,255,255,0.3);color:#fff;font-size:16px;cursor:pointer;padding:4px 12px;border-radius:4px;flex-shrink:0;';
    closeBtn.textContent = '✕';
    closeBtn.onclick = () => setMaximized(false);
    header.appendChild(closeBtn);

    const body = doc.createElement('div');
    body.style.cssText = 'flex:1;';
    const iframe = doc.createElement('iframe');
    iframe.src = viewerUrl(selectedRegion.chartPdfUrl);
    iframe.style.cssText = 'width:100%;height:100%;border:none;';
    iframe.title = selectedRegion.chartName;
    body.appendChild(iframe);

    overlay.appendChild(header);
    overlay.appendChild(body);
    doc.body.appendChild(overlay);
    overlayRef.current = overlay;

    return () => {
      if (overlayRef.current) {
        doc.body.removeChild(overlayRef.current);
        overlayRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maximized, selectedRegion, regions, selectedIdx]);

  // Update overlay iframe + chip highlights when switching charts
  useEffect(() => {
    if (!maximized || !overlayRef.current || !selectedRegion) return;
    const iframe = overlayRef.current.querySelector('iframe');
    if (iframe) iframe.src = viewerUrl(selectedRegion.chartPdfUrl);

    const chipBtns = overlayRef.current.querySelectorAll(
      'div:first-child > div:first-child > button',
    );
    chipBtns.forEach((chip: any, idx: number) => {
      const active = idx === selectedIdx;
      const highlighted = highlightSet.has(regions[idx]?.regionId ?? '');
      chip.style.borderColor = active ? 'rgba(96,165,250,0.6)' : highlighted ? 'rgba(239,68,68,0.4)' : 'rgba(255,255,255,0.2)';
      chip.style.background = active ? 'rgba(96,165,250,0.15)' : highlighted ? 'rgba(239,68,68,0.08)' : 'transparent';
      chip.style.color = active ? '#93c5fd' : highlighted ? '#fca5a5' : 'rgba(255,255,255,0.7)';
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIdx, maximized, selectedRegion]);

  // Escape closes overlay
  useEffect(() => {
    if (Platform.OS !== 'web' || !maximized) return;
    const doc = getDoc();
    if (!doc) return;
    const handler = (e: any) => {
      if (e.key === 'Escape') setMaximized(false);
    };
    doc.addEventListener('keydown', handler);
    return () => doc.removeEventListener('keydown', handler);
  }, [maximized]);

  if (loading) {
    return (
      <View className="items-center py-2">
        <Text className="text-xs text-muted-foreground">{t('common.loading')}</Text>
      </View>
    );
  }

  if (regions.length === 0) {
    return (
      <View className="py-2">
        <Text className="text-xs text-muted-foreground">{t('vfr.noChartsFound')}</Text>
      </View>
    );
  }

  return (
    <View className="mt-1.5">
      {/* Region selector chips */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-2">
        <View className="flex-row gap-1.5">
          {regions.map((region, idx) => {
            const isSelected = idx === selectedIdx;
            const isHighlighted = highlightSet.has(region.regionId);
            return (
              <Pressable
                key={region.regionId}
                onPress={() => setSelectedIdx(isSelected ? null : idx)}
                className={`rounded-sm border px-2.5 py-1.5 ${
                  isSelected
                    ? 'border-primary bg-primary/10'
                    : isHighlighted
                      ? 'border-red-400 bg-red-50'
                      : 'border-border bg-surface'
                }`}
              >
                <Text
                  className={`text-[10px] font-bold ${
                    isSelected ? 'text-primary' : isHighlighted ? 'text-red-600' : 'text-foreground'
                  }`}
                >
                  {region.chartName}
                </Text>
                {isHighlighted ? (
                  <Text className="text-[8px] text-red-500">●</Text>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      {/* Embedded PDF viewer */}
      {selectedRegion ? (
        <View>
          <View className="mb-1 flex-row items-center justify-end gap-2">
            <Text className="mr-auto flex-1 text-[10px] text-muted-foreground" numberOfLines={1}>
              DECEA AISWEB — {selectedRegion.chartName}
            </Text>
            <Pressable
              onPress={() => (globalThis as any).window?.open(selectedRegion.chartPdfUrl, '_blank')}
              className="rounded-sm border border-border px-2 py-0.5 active:bg-muted"
            >
              <Text className="text-[10px] text-muted-foreground">↗</Text>
            </Pressable>
            <Pressable
              onPress={() => setMaximized(true)}
              className="rounded-sm border border-border px-2 py-0.5 active:bg-muted"
            >
              <Text className="text-[10px] font-medium text-primary">⤢</Text>
            </Pressable>
          </View>
          <View
            style={{ height: VIEWER_HEIGHT, borderRadius: 6, overflow: 'hidden' }}
            className="border border-border"
          >
            <View ref={iframeRef} style={{ flex: 1 }} />
          </View>
        </View>
      ) : null}
    </View>
  );
}
