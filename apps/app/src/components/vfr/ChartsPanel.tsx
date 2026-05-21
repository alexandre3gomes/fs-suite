import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native';

import { trackAction } from '../../services/analytics';
import { API_URL, apiClient } from '../../services/api.client';

import { type DomElement, type DomKeyboardEvent, getDoc, openExternal } from './dom-types';

// --------------- Types ---------------

interface AerodromeChart {
  type: string;
  name: string;
  url: string;
  source: string;
}

interface ChartSearchResult {
  icao: string;
  charts: AerodromeChart[];
  sourceLinks: { label: string; url: string }[];
  moreLinks: { label: string; url: string }[];
}

interface Props {
  icao: string;
  flightRules?: 'VFR' | 'IFR' | 'VFR_IFR' | 'IFR_VFR';
  fullscreen?: boolean;
}

const VFR_CHART_TYPES = new Set(['ADC', 'PDC', 'VAC', 'INFO', 'OTHER']);
const IFR_CHART_TYPES = new Set(['ADC', 'PDC', 'SID', 'STAR', 'IAC', 'MIN', 'INFO', 'OTHER']);

function filterChartsByRules(charts: AerodromeChart[], rules?: string): AerodromeChart[] {
  if (!rules || rules === 'VFR_IFR' || rules === 'IFR_VFR') return charts;
  const allowed = rules === 'IFR' ? IFR_CHART_TYPES : VFR_CHART_TYPES;
  return charts.filter((c) => allowed.has(c.type));
}

// --------------- Helpers ---------------

/** Build a proxy URL that serves the PDF inline (strips Content-Disposition: attachment) */
function proxyUrl(chartUrl: string): string {
  return `${API_URL}/v1/aerodromes/chart-proxy?url=${encodeURIComponent(chartUrl)}`;
}

// --------------- Component ---------------

function useViewerHeight(base: number): number {
  const { height } = useWindowDimensions();
  return height < 700 ? Math.round(height * 0.45) : base;
}

export function ChartsPanel({ icao, flightRules, fullscreen }: Props) {
  const { t } = useTranslation();
  const viewerHeight = useViewerHeight(450);
  const [data, setData] = useState<ChartSearchResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [maximized, setMaximized] = useState(false);
  const iframeRef = useRef<View>(null);
  const overlayRef = useRef<DomElement | null>(null);

  // Fetch charts on mount / icao change
  useEffect(() => {
    setLoading(true);
    setSelectedIdx(0);
    void apiClient
      .get<ChartSearchResult>(`/aerodromes/${icao}/charts`)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [icao]);

  // Reset selection when flight rules change
  useEffect(() => { setSelectedIdx(0); }, [flightRules]);

  const charts = filterChartsByRules(data?.charts ?? [], flightRules);
  const selectedChart = charts[selectedIdx];

  // Render inline iframe with selected chart PDF
  useEffect(() => {
    if (Platform.OS !== 'web' || !iframeRef.current || !selectedChart) return;
    trackAction('chart_viewed', { icao, chart_type: selectedChart.type, source: selectedChart.source });
    const doc = getDoc();
    if (!doc) return;
    const el = iframeRef.current as unknown as DomElement;

    el.innerHTML = '';
    const iframe = doc.createElement('iframe');
    iframe.src = proxyUrl(selectedChart.url);
    iframe.style.cssText = 'width:100%;height:100%;border:none;';
    iframe.title = selectedChart.name;
    el.appendChild(iframe);
  }, [selectedChart]);

  // Maximized overlay
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const doc = getDoc();
    if (!doc) return;

    if (!maximized || !selectedChart) {
      if (overlayRef.current) {
        doc.body.removeChild(overlayRef.current);
        overlayRef.current = null;
      }
      return;
    }

    const overlay = doc.createElement('div');
    overlay.style.cssText =
      'position:fixed;top:0;left:0;right:0;bottom:0;z-index:9999;background:rgba(0,0,0,0.95);display:flex;flex-direction:column;';

    // ---- Header ----
    const header = doc.createElement('div');
    header.style.cssText =
      'display:flex;align-items:center;gap:8px;padding:10px 16px;border-bottom:1px solid rgba(255,255,255,0.1);';

    // Chart selector chips
    if (charts.length > 1) {
      const chipsWrap = doc.createElement('div');
      chipsWrap.style.cssText = 'display:flex;gap:6px;flex:1;overflow-x:auto;';
      charts.forEach((c: AerodromeChart, idx: number) => {
        const chip = doc.createElement('button');
        const active = idx === selectedIdx;
        chip.style.cssText =
          'padding:4px 10px;border-radius:4px;cursor:pointer;white-space:nowrap;font-size:11px;font-weight:600;' +
          `border:1px solid ${active ? 'rgba(96,165,250,0.6)' : 'rgba(255,255,255,0.2)'};` +
          `background:${active ? 'rgba(96,165,250,0.15)' : 'transparent'};` +
          `color:${active ? '#93c5fd' : 'rgba(255,255,255,0.7)'};`;
        chip.textContent = `${c.type} — ${c.name}`;
        chip.onclick = () => setSelectedIdx(idx);
        chipsWrap.appendChild(chip);
      });
      header.appendChild(chipsWrap);
    } else {
      const title = doc.createElement('span');
      title.style.cssText = 'color:#fff;font-size:13px;font-weight:600;flex:1;';
      title.textContent = `${selectedChart.type} — ${selectedChart.name}`;
      header.appendChild(title);
    }

    // Open in new tab button
    const extBtn = doc.createElement('button');
    extBtn.style.cssText =
      'background:none;border:1px solid rgba(255,255,255,0.2);color:rgba(255,255,255,0.7);font-size:12px;cursor:pointer;padding:4px 10px;border-radius:4px;flex-shrink:0;';
    extBtn.textContent = '↗';
    extBtn.title = 'Open in new tab';
    extBtn.onclick = () => openExternal(selectedChart.url);
    header.appendChild(extBtn);

    const closeBtn = doc.createElement('button');
    closeBtn.style.cssText =
      'background:none;border:1px solid rgba(255,255,255,0.3);color:#fff;font-size:16px;cursor:pointer;padding:4px 12px;border-radius:4px;flex-shrink:0;';
    closeBtn.textContent = '✕';
    closeBtn.onclick = () => setMaximized(false);
    header.appendChild(closeBtn);

    // ---- Chart PDF ----
    const body = doc.createElement('div');
    body.style.cssText = 'flex:1;';
    const iframe = doc.createElement('iframe');
    iframe.src = proxyUrl(selectedChart.url);
    iframe.style.cssText = 'width:100%;height:100%;border:none;';
    iframe.title = selectedChart.name;
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
  }, [maximized, selectedChart, charts, selectedIdx]);

  // Update overlay iframe + chip highlights when switching charts
  useEffect(() => {
    if (!maximized || !overlayRef.current || !selectedChart) return;

    const iframe = overlayRef.current.querySelector?.('iframe');
    if (iframe) iframe.src = proxyUrl(selectedChart.url);

    const chipBtns = overlayRef.current.querySelectorAll?.(
      'div:first-child > div:first-child > button',
    ) ?? [];
    chipBtns.forEach((chip: DomElement, idx: number) => {
      const active = idx === selectedIdx;
      const s = chip.style;
      s.borderColor = active ? 'rgba(96,165,250,0.6)' : 'rgba(255,255,255,0.2)';
      s.background = active ? 'rgba(96,165,250,0.15)' : 'transparent';
      s.color = active ? '#93c5fd' : 'rgba(255,255,255,0.7)';
    });
  }, [selectedIdx, maximized, selectedChart]);

  // Escape closes overlay
  useEffect(() => {
    if (Platform.OS !== 'web' || !maximized) return;
    const doc = getDoc();
    if (!doc) return;
    const handler = (e: DomKeyboardEvent) => {
      if (e.key === 'Escape') setMaximized(false);
    };
    doc.addEventListener('keydown', handler);
    return () => doc.removeEventListener('keydown', handler);
  }, [maximized]);

  const openUrl = (url: string) => {
    openExternal(url);
  };

  // ---- Loading ----
  if (loading) {
    return (
      <View className="items-center py-4">
        <Text className="text-xs text-muted-foreground">{t('common.loading')}</Text>
      </View>
    );
  }

  if (!data) {
    return (
      <View className="py-2">
        <Text className="text-xs text-muted-foreground">{t('vfr.noChartsFound')}</Text>
      </View>
    );
  }

  return (
    <View className="mt-1.5" style={fullscreen ? { flex: 1 } : undefined}>
      {/* ---- Direct chart PDFs ---- */}
      {charts.length > 0 ? (
        <View style={fullscreen ? { flex: 1, display: 'flex' } : undefined}>
          {/* Chart selector chips */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-2">
            <View className="flex-row gap-1.5">
              {charts.map((chart, idx) => (
                <Pressable
                  key={idx}
                  onPress={() => setSelectedIdx(idx)}
                  className={`rounded-sm border px-2.5 py-1.5 ${
                    idx === selectedIdx
                      ? 'border-primary bg-primary/10'
                      : 'border-border bg-surface'
                  }`}
                >
                  <Text
                    className={`text-[10px] font-bold ${
                      idx === selectedIdx ? 'text-primary' : 'text-foreground'
                    }`}
                  >
                    {chart.type}
                  </Text>
                  <Text
                    className="max-w-[140px] text-[9px] text-muted-foreground"
                    numberOfLines={1}
                  >
                    {chart.name}
                  </Text>
                </Pressable>
              ))}
            </View>
          </ScrollView>

          {/* Embedded PDF viewer */}
          {selectedChart ? (
            <View style={fullscreen ? { flex: 1 } : undefined}>
              <View className="mb-1 flex-row items-center justify-end gap-2">
                <Text className="mr-auto flex-1 text-[10px] text-muted-foreground" numberOfLines={1}>
                  {selectedChart.source} — {selectedChart.name}
                </Text>
                <Pressable
                  onPress={() => openUrl(selectedChart.url)}
                  className="rounded-sm border border-border px-2 py-0.5 active:bg-muted"
                >
                  <Text className="text-[10px] text-muted-foreground">↗</Text>
                </Pressable>
                {!fullscreen ? (
                  <Pressable
                    onPress={() => setMaximized(true)}
                    className="rounded-sm border border-border px-2 py-0.5 active:bg-muted"
                  >
                    <Text className="text-[10px] font-medium text-primary">⤢</Text>
                  </Pressable>
                ) : null}
              </View>
              <View
                style={fullscreen ? { flex: 1, borderRadius: 6, overflow: 'hidden' } : { height: viewerHeight, borderRadius: 6, overflow: 'hidden' }}
                className="border border-border"
              >
                <View ref={iframeRef} style={{ flex: 1 }} />
              </View>
            </View>
          ) : null}
        </View>
      ) : (
        <Text className="mb-2 text-xs text-muted-foreground">{t('vfr.noChartsFound')}</Text>
      )}

      {/* ---- Source links ---- */}
      {data.sourceLinks.length > 0 ? (
        <View className="mt-2">
          <Text className="mb-1 text-[10px] font-semibold text-muted-foreground">
            {t('vfr.chartSources')}
          </Text>
          <View className="flex-row flex-wrap gap-1.5">
            {data.sourceLinks.map((link, idx) => (
              <Pressable
                key={idx}
                onPress={() => openUrl(link.url)}
                className="rounded-sm border border-border bg-surface px-2 py-1 active:bg-muted"
              >
                <Text className="text-[10px] font-medium text-primary">{link.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}

      {/* ---- More charts ---- */}
      {data.moreLinks.length > 0 ? (
        <View className="mt-1.5">
          <Text className="mb-1 text-[10px] font-semibold text-muted-foreground">
            {t('vfr.chartMore')}
          </Text>
          <View className="flex-row flex-wrap gap-1.5">
            {data.moreLinks.map((link, idx) => (
              <Pressable
                key={idx}
                onPress={() => openUrl(link.url)}
                className="rounded-sm border border-border bg-surface px-2 py-1 active:bg-muted"
              >
                <Text className="text-[10px] font-medium text-primary">{link.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}
