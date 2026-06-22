import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';
import { Dropdown } from 'react-native-element-dropdown';

import { categorizeError, trackAction, trackFailure } from '../../services/analytics';
import { apiClient } from '../../services/api.client';

import { ChartViewer, type ViewerChart } from './ChartViewer';
import { openExternal } from './dom-types';

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

export interface ChartOverlay {
  id: string;
  icao: string;
  chartType: string;
  chartName: string;
  sourceUrl: string;
  bounds: { south: number; west: number; north: number; east: number };
  rotationDeg: number;
  opacityDefault: number;
  imageWidth: number;
  imageHeight: number;
  /** True when the chart lacked a usable georeference and the placement is a
   *  runway-scaled approximation centred on the field. */
  approximate?: boolean;
}

/** Chart types eligible to be projected on the map (MVP: VAC only). */
const OVERLAY_ELIGIBLE_TYPES = new Set(['VAC']);

interface Props {
  icao: string;
  flightRules?: 'VFR' | 'IFR' | 'VFR_IFR' | 'IFR_VFR';
  /** Source URLs of the charts currently plotted (to highlight matching chips) */
  activeOverlayChartUrls?: string[];
  /** Called when the user toggles a chart overlay on the map */
  onShowOverlay?: (overlay: ChartOverlay) => void;
  /** Called when the user removes a specific chart overlay (by its source URL) */
  onHideOverlay?: (chartUrl: string) => void;
}

const VFR_CHART_TYPES = new Set(['ADC', 'PDC', 'VAC', 'INFO', 'OTHER']);
const IFR_CHART_TYPES = new Set(['ADC', 'PDC', 'SID', 'STAR', 'IAC', 'MIN', 'INFO', 'OTHER']);

/** Ordering of chart types for the grouped picker, mirroring SkyVector. */
const GROUP_ORDER: { labelKey: string; types: string[] }[] = [
  { labelKey: 'vfr.chartGroupAerodrome', types: ['ADC', 'PDC', 'VAC', 'INFO'] },
  { labelKey: 'vfr.chartGroupInstrument', types: ['SID', 'STAR', 'IAC', 'MIN'] },
  { labelKey: 'vfr.chartGroupOther', types: ['OTHER'] },
];

function filterChartsByRules(charts: AerodromeChart[], rules?: string): AerodromeChart[] {
  if (!rules || rules === 'VFR_IFR' || rules === 'IFR_VFR') return charts;
  const allowed = rules === 'IFR' ? IFR_CHART_TYPES : VFR_CHART_TYPES;
  return charts.filter((c) => allowed.has(c.type));
}

function groupRank(type: string): number {
  const idx = GROUP_ORDER.findIndex((g) => g.types.includes(type));
  return idx === -1 ? GROUP_ORDER.length : idx;
}

// --------------- Component ---------------

export function ChartsPanel({ icao, flightRules, activeOverlayChartUrls, onShowOverlay, onHideOverlay }: Props) {
  const { t } = useTranslation();
  const [data, setData] = useState<ChartSearchResult | null>(null);
  const [loading, setLoading] = useState(true);
  // Chart fetch failed (distinct from "loaded but empty"). Kept local so chart
  // loading never couples to — or blocks — the main plan/form state.
  const [error, setError] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(-1);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [overlayLoading, setOverlayLoading] = useState(false);
  // Bumped on each pick to reset the select back to its "Selecione" placeholder,
  // so picking the same chart again re-opens the viewer.
  const [pickerNonce, setPickerNonce] = useState(0);

  // Fetch charts on mount / icao change. This runs in the background: a failure
  // (or slowness) here must never block aerodrome data, METAR/TAF, runway
  // suggestion, fuel calc or the save button — only this panel reflects it.
  useEffect(() => {
    // Guard against out-of-order responses: when the aerodrome changes quickly,
    // a slower earlier request must not overwrite the current one's state.
    let active = true;
    setLoading(true);
    setError(false);
    setData(null); // clear the previous aerodrome's charts/links while loading
    setSelectedIdx(-1);
    setViewerIndex(null);
    void apiClient
      .get<ChartSearchResult>(`/aerodromes/${icao}/charts`)
      .then((res) => {
        if (!active) return;
        setData(res);
        setError(false);
      })
      .catch(() => {
        if (!active) return;
        setData(null);
        setError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [icao]);

  // Reset selection when flight rules change
  useEffect(() => {
    setSelectedIdx(-1);
    setViewerIndex(null);
  }, [flightRules]);

  // Charts filtered by flight rules, then sorted by group so the picker reads
  // top-to-bottom like SkyVector (Aerodrome → Instrument → Other).
  const charts = useMemo<AerodromeChart[]>(() => {
    const filtered = filterChartsByRules(data?.charts ?? [], flightRules);
    return [...filtered].sort((a, b) => groupRank(a.type) - groupRank(b.type));
  }, [data, flightRules]);

  const dropdownData = useMemo(
    () =>
      charts.map((c, idx) => ({
        label: `${c.type} — ${c.name}`,
        value: String(idx),
        search: `${c.type} ${c.name} ${c.source}`.toLowerCase(),
        groupLabel: t(GROUP_ORDER[groupRank(c.type)]?.labelKey ?? 'vfr.chartGroupOther'),
        type: c.type,
      })),
    [charts, t],
  );

  const selectedChart = charts[selectedIdx];

  const requestOverlay = async (chart: AerodromeChart) => {
    if (!onShowOverlay) return;
    setOverlayLoading(true);
    try {
      const params = new URLSearchParams({
        url: chart.url,
        type: chart.type,
        name: chart.name,
        authority: chart.source,
      });
      const overlay = await apiClient.get<ChartOverlay>(
        `/aerodromes/${icao}/chart-overlay?${params.toString()}`,
      );
      onShowOverlay(overlay);
      trackAction('chart_overlay_shown', { icao, chart_type: chart.type, source: chart.source });
    } catch (err) {
      const { errorType, statusCode } = categorizeError(err);
      trackFailure('chart_overlay_failed', errorType, { icao, chart_type: chart.type, status_code: statusCode });
    } finally {
      setOverlayLoading(false);
    }
  };

  // The select box is always rendered so chart loading is visibly secondary and
  // never collapses or shifts the rest of the form. Its interactivity and
  // placeholder reflect the background fetch:
  //   loading → disabled "Carregando cartas..."
  //   error   → disabled "Cartas indisponíveis" (discreet; no alert/modal)
  //   empty   → disabled "Nenhuma carta encontrada"
  //   ready   → enabled  "Selecione uma carta"
  const ready = !loading && !error && charts.length > 0;
  const placeholder = loading
    ? t('vfr.chartsLoading')
    : error
      ? t('vfr.chartsUnavailable')
      : charts.length === 0
        ? t('vfr.noChartsFound')
        : t('vfr.chartSelectPlaceholder');

  return (
    <View className="mt-1.5">
      <View>
        {/* Grouped chart picker — sits on the "Selecione" placeholder; picking
            a chart opens it straight in the floating viewer. */}
        <Dropdown
          key={pickerNonce}
          disable={!ready}
          data={ready ? dropdownData : []}
          labelField="label"
          valueField="value"
          searchField="search"
          value={''}
          onChange={(item: { value: string }) => {
            const idx = parseInt(item.value, 10);
            setSelectedIdx(idx);
            setViewerIndex(idx);
            setPickerNonce((n) => n + 1);
          }}
          search={ready && dropdownData.length > 6}
          searchPlaceholder={t('common.search', { defaultValue: 'Buscar...' })}
          placeholder={placeholder}
          style={{
            borderWidth: 1,
            borderColor: '#e5e7eb',
            borderRadius: 6,
            paddingHorizontal: 10,
            paddingVertical: 7,
            backgroundColor: 'var(--input, #fff)',
            opacity: ready ? 1 : 0.6,
          }}
          placeholderStyle={{ fontSize: 12, color: '#9ca3af' }}
          selectedTextStyle={{ fontSize: 12, color: 'var(--foreground, #1a1d26)' }}
          inputSearchStyle={{ fontSize: 13, borderColor: '#e5e7eb', borderRadius: 6, paddingHorizontal: 8, height: 34 }}
          containerStyle={{
            borderRadius: 8,
            borderColor: '#e5e7eb',
            shadowColor: '#000',
            shadowOpacity: 0.08,
            shadowRadius: 8,
            shadowOffset: { width: 0, height: 4 },
            overflow: 'hidden',
          }}
          maxHeight={300}
          renderItem={(item) => (
            <View style={{ paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#f3f4f6' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={{ fontSize: 11, fontWeight: '700', color: '#2563eb', minWidth: 34 }}>{item.type}</Text>
                <Text style={{ fontSize: 13, color: '#1a1d26', flex: 1 }} numberOfLines={1}>
                  {item.label.replace(`${item.type} — `, '')}
                </Text>
              </View>
              <Text style={{ fontSize: 9, color: '#9ca3af', marginTop: 1 }}>{item.groupLabel}</Text>
            </View>
          )}
        />

        {/* Map-overlay toggle for the last-picked VAC (georeferenced on the map).
            Separate from the viewer; only VAC charts are eligible. */}
        {ready && selectedChart && OVERLAY_ELIGIBLE_TYPES.has(selectedChart.type) && onShowOverlay ? (
            (() => {
              const isActive = !!activeOverlayChartUrls?.includes(selectedChart.url);
              return (
                <View className="mt-1.5 flex-row items-center gap-2">
                  <Text className="mr-auto flex-1 text-[10px] text-muted-foreground" numberOfLines={1}>
                    {selectedChart.type} — {selectedChart.name}
                  </Text>
                  <Pressable
                    disabled={overlayLoading}
                    onPress={() => {
                      if (isActive) onHideOverlay?.(selectedChart.url);
                      else void requestOverlay(selectedChart);
                    }}
                    className={`rounded-sm border px-2 py-0.5 active:bg-muted ${
                      isActive ? 'border-primary bg-primary/10' : 'border-border'
                    } ${overlayLoading ? 'opacity-60' : ''}`}
                  >
                    <Text className={`text-[10px] font-medium ${isActive ? 'text-primary' : 'text-muted-foreground'}`}>
                      {overlayLoading
                        ? `⏳ ${t('common.loading')}`
                        : isActive
                          ? `✓ ${t('vfr.chartHideFromMap')}`
                          : `📍 ${t('vfr.chartShowOnMap')}`}
                    </Text>
                  </Pressable>
                </View>
              );
            })()
        ) : null}
      </View>

      {/* Floating viewer window (web only) */}
      <ChartViewer
        charts={charts as ViewerChart[]}
        openIndex={viewerIndex}
        icao={icao}
        onClose={() => setViewerIndex(null)}
      />

      {/* ---- Source links ---- */}
      {data && data.sourceLinks.length > 0 ? (
        <View className="mt-2">
          <Text className="mb-1 text-[10px] font-semibold text-muted-foreground">
            {t('vfr.chartSources')}
          </Text>
          <View className="flex-row flex-wrap gap-1.5">
            {data.sourceLinks.map((link, idx) => (
              <Pressable
                key={idx}
                onPress={() => openExternal(link.url)}
                className="rounded-sm border border-border bg-surface px-2 py-1 active:bg-muted"
              >
                <Text className="text-[10px] font-medium text-primary">{link.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}

      {/* ---- More charts ---- */}
      {data && data.moreLinks.length > 0 ? (
        <View className="mt-1.5">
          <Text className="mb-1 text-[10px] font-semibold text-muted-foreground">
            {t('vfr.chartMore')}
          </Text>
          <View className="flex-row flex-wrap gap-1.5">
            {data.moreLinks.map((link, idx) => (
              <Pressable
                key={idx}
                onPress={() => openExternal(link.url)}
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
