import type L from 'leaflet';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable, Text, View } from 'react-native';

import { apiClient } from '../../services/api.client';

import type { Aerodrome } from './AerodromeSearch';
import type { ParsedMetar } from './MetarDisplay';
import { type DomDocument, type DomElement, type DomEvent } from './dom-types';
import { type RouteWaypoint, type TocTodPosition, haversineDistanceNm, initialBearing, getMagneticDeclination } from './vfrNavigation';

type LeafletModule = typeof L;

interface WmsFeatureProperties {
  typ?: string;
  nam?: string;
  ident?: string;
  upperlimit?: number;
  uplimituni?: string;
  lowerlimi1?: number;
  lowerlimit?: string;
  codedistv1?: string;
  relatedfir?: string;
}

interface WmsFeature {
  properties?: WmsFeatureProperties;
}

interface WmsFeatureInfoResponse {
  features?: WmsFeature[];
}

// --------------- Types ---------------

interface MapAerodrome extends Aerodrome {
  flightCategory?: string | null;
}

export interface ReaCorridorSegment {
  nome: string;
  tipo: 'Obrig' | 'Recom';
  trecho: number;
  fixoA: { lat: number; lon: number; nome: string };
  fixoB: { lat: number; lon: number; nome: string };
  altMinAtoB: number;
  altMaxAtoB: number;
  altMinBtoA: number;
  altMaxBtoA: number;
  fca: string;
  geometry: { type: string; coordinates: number[][][][] | number[][][] };
}

interface PopupRunway {
  leIdent: string | null;
  leHeadingDeg: number | null;
  heIdent: string | null;
  heHeadingDeg: number | null;
  closed: boolean;
  ident: string;
  lengthFt: number | null;
}

interface PopupAerodromeDetail {
  runways: PopupRunway[];
}

interface MapReadyHandle {
  flyTo: (lat: number, lng: number) => void;
  getContainer: () => HTMLElement | null;
  fitRouteBounds: () => { center: [number, number]; zoom: number } | null;
  setView: (center: [number, number], zoom: number) => void;
}

interface Props {
  onSelectOrigin: (a: Aerodrome) => void;
  onSelectDestination: (a: Aerodrome) => void;
  onSelectAlternate: (a: Aerodrome) => void;
  onMapReady?: (handle: MapReadyHandle) => void;
  routeOrigin?: { lat: number; lng: number; name: string } | null;
  routeDestination?: { lat: number; lng: number; name: string } | null;
  routeAlternate?: { lat: number; lng: number; name: string } | null;
  routeWaypoints?: RouteWaypoint[];
  onAddWaypoint?: (wp: RouteWaypoint) => void;
  onRemoveWaypoint?: (index: number) => void;
  onUpdateWaypoint?: (index: number, wp: RouteWaypoint) => void;
  reaSegments?: ReaCorridorSegment[];
  selectedReaCorridorName?: string | null;
  flightRules?: 'VFR' | 'IFR' | 'VFR_IFR' | 'IFR_VFR';
  tocTodPositions?: TocTodPosition[];
}

// --------------- Constants ---------------

const CATEGORY_COLORS: Record<string, string> = {
  VFR: '#16a34a',
  MVFR: '#2563eb',
  IFR: '#dc2626',
  LIFR: '#d946ef',
};
const CATEGORY_BG_COLORS: Record<string, string> = {
  VFR: 'rgba(20,83,45,0.8)',
  MVFR: 'rgba(30,58,95,0.8)',
  IFR: 'rgba(127,29,29,0.8)',
  LIFR: 'rgba(107,33,168,0.8)',
};
const DEFAULT_DOT_COLOR = '#94a3b8';
const DEFAULT_BADGE_BG = 'rgba(55,65,81,0.8)';
const MAX_METAR_FETCH = 50;
const DEFAULT_CENTER: [number, number] = [-15.78, -47.93];
const DEFAULT_ZOOM = 5;
const TILE_LAYERS = {
  map: {
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    attr: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
    i18nKey: 'vfr.layerMap',
  },
  satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attr: '&copy; Esri, Maxar, Earthstar Geographics',
    i18nKey: 'vfr.layerSatellite',
  },
  topo: {
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    attr: '&copy; <a href="https://opentopomap.org">OpenTopoMap</a> &copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>',
    i18nKey: 'vfr.layerTopo',
  },
} as const;
type LayerKey = keyof typeof TILE_LAYERS;

const OPENAIP_API_KEY = '713c06c03613151e4bf4d19916ac6773';
const OPENAIP_TILE_URL = `https://api.tiles.openaip.net/api/data/openaip/{z}/{x}/{y}.png?apiKey=${OPENAIP_API_KEY}`;

const DECEA_WMS_BASE = 'https://geoaisweb.decea.mil.br/geoserver/ICA/wms';
type ChartOverlayKey = 'rea' | 'wac' | 'enrcL' | 'enrcH' | 'airspaceDecea';
const DECEA_CHART_OVERLAYS: Record<ChartOverlayKey, { layers: string; i18nKey: string; minZoom: number; maxZoom: number; opacity: number }> = {
  rea: { layers: 'ICA:CCV_REA_CY_CUIABA,ICA:CCV_REA_PI-PARINTINS,ICA:CCV_REA_WA_TABATINGA,ICA:CCV_REA_WB_BELEM,ICA:CCV_REA_WF_RECIFE,ICA:CCV_REA_WG_CAMPO_GRANDE,ICA:CCV_REA_WH_BELO_HORIZONTE,ICA:CCV_REA_WJ1_RIO_DE_JANEIRO,ICA:CCV_REA_WK_PORTO_SEGURO,ICA:CCV_REA_WN2_MANAUS,ICA:CCV_REA_WP_PORTO_ALEGRE,ICA:CCV_REA_WR_BRASILIA,ICA:CCV_REA_WS_SAO_LUIS,ICA:CCV_REA_WX_SANTAREM,ICA:CCV_REA_WZ_FORTALEZA,ICA:CCV_REA_XF_FLORIANOPOLIS,ICA:CCV_REA_XK_MACAPA,ICA:CCV_REA_XN-ANAPOLIS,ICA:CCV_REA_XP1_SAO_PAULO,ICA:CCV_REA_XP2_SAO_PAULO,ICA:CCV_REA_XR_VITORIA,ICA:CCV_REA_XS_SALVADOR,ICA:CCV_REA_XT_NATAL', i18nKey: 'vfr.layerRea', minZoom: 7, maxZoom: 14, opacity: 0.75 },
  wac: { layers: 'ICA:WAC_2825_CABO_ORANGE,ICA:WAC_2826_MONTE_RORAIMA,ICA:WAC_2827_SERRA_PACARAIMA,ICA:WAC_2892_PICO_DA_NEBLINA,ICA:WAC_2893_BOA_VISTA,ICA:WAC_2894_TUMUCUMAQUE,ICA:WAC_2895_MACAPA,ICA:WAC_2944_FORTALEZA,ICA:WAC_2945_SAO_LUIS,ICA:WAC_2946_BELEM,ICA:WAC_2947_SANTAREM,ICA:WAC_2948_MANAUS,ICA:WAC_2949_SAO_GABRIEL_DA_CACHOEIRA,ICA:WAC_3012_CRUZEIRO_DO_SUL,ICA:WAC_3013_TABATINGA,ICA:WAC_3014_HUMAITA,ICA:WAC_3015_ITAITUBA,ICA:WAC_3016_IMPERATRIZ,ICA:WAC_3017_TERESINA,ICA:WAC_3018_NATAL,ICA:WAC_3019_FERNANDO_DE_NORONHA,ICA:WAC_3066_RECIFE,ICA:WAC_3067_PETROLINA,ICA:WAC_3068_PORTO_NACIONAL,ICA:WAC_3069_CACHIMBO,ICA:WAC_3070_JI_PARANA,ICA:WAC_3071_PORTO_VELHO,ICA:WAC_3072_TARAUACA,ICA:WAC_3137_PRINCIPE_DA_BEIRA,ICA:WAC_3138_CUIABA,ICA:WAC_3139_ARAGARCAS,ICA:WAC_3140_BRASILIA,ICA:WAC_3141_SALVADOR,ICA:WAC_3189_BELO_HORIZONTE,ICA:WAC_3190_GOIANIA,ICA:WAC_3191_RONDONOPOLIS,ICA:WAC_3192_CORUMBA,ICA:WAC_3260_BELA_VISTA,ICA:WAC_3261_CAMPO_GRANDE,ICA:WAC_3262_SAO_PAULO,ICA:WAC_3263_RIO_DE_JANEIRO,ICA:WAC_3313_CURITIBA,ICA:WAC_3314_FOZ_DO_IGUACU,ICA:WAC_3383_URUGUAIANA,ICA:WAC_3384_PORTO_ALEGRE,ICA:WAC_3434_RIO_DA_PRATA', i18nKey: 'vfr.layerWac', minZoom: 6, maxZoom: 12, opacity: 0.6 },
  enrcL: { layers: 'ICA:ENRC_L1,ICA:ENRC_L2,ICA:ENRC_L3,ICA:ENRC_L4,ICA:ENRC_L5,ICA:ENRC_L6,ICA:ENRC_L7,ICA:ENRC_L8,ICA:ENRC_L9', i18nKey: 'vfr.layerEnrcLow', minZoom: 5, maxZoom: 12, opacity: 0.65 },
  enrcH: { layers: 'ICA:ENRC_H1,ICA:ENRC_H2,ICA:ENRC_H3,ICA:ENRC_H4,ICA:ENRC_H5,ICA:ENRC_H6,ICA:ENRC_H7,ICA:ENRC_H8,ICA:ENRC_H9', i18nKey: 'vfr.layerEnrcHigh', minZoom: 5, maxZoom: 12, opacity: 0.65 },
  airspaceDecea: { layers: 'ICA:SETOR_FIR,ICA:TMA,ICA:CTR,ICA:ATZ', i18nKey: 'vfr.layerAirspaceDecea', minZoom: 5, maxZoom: 14, opacity: 0.5 },
};


const ROUTE_COLOR = '#a855f7';
const ROUTE_OUTLINE = '#4c1d95';
const ALT_ROUTE_COLOR = '#f59e0b';
const ALT_ROUTE_OUTLINE = '#78350f';

// --------------- CSS injection ---------------

let cssInjected = false;
function injectLeafletCSS() {
  if (cssInjected || Platform.OS !== 'web') return;
  cssInjected = true;
  const doc = (globalThis as Record<string, unknown>).document as DomDocument;
  const link = doc.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
  link.crossOrigin = '';
  doc.head.appendChild(link);

  const style = doc.createElement('style');
  style.textContent = '.leg-label-tooltip { background:none !important; border:none !important; box-shadow:none !important; padding:0 !important; } .route-leg-pill { background:none !important; border:none !important; box-shadow:none !important; padding:0 !important; } .leaflet-marker-draggable { cursor:move !important; }';
  doc.head.appendChild(style);
}

// --------------- Component ---------------

export function AerodromeMap({
  onSelectOrigin, onSelectDestination, onSelectAlternate, onMapReady,
  routeOrigin, routeDestination, routeAlternate, routeWaypoints, onAddWaypoint, onRemoveWaypoint, onUpdateWaypoint,
  reaSegments, selectedReaCorridorName, flightRules, tocTodPositions,
}: Props) {
  const { t } = useTranslation();
  const wrapperRef = useRef<View>(null);
  const containerRef = useRef<View>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const markersRef = useRef<L.Marker[]>([]);
  const routeLayerRef = useRef<L.LayerGroup | null>(null);
  const reaLayerRef = useRef<L.LayerGroup | null>(null);
  const openAipLayerRef = useRef<L.TileLayer | null>(null);
  const chartLayersRef = useRef<Record<string, L.TileLayer.WMS>>({});
  const [ready, setReady] = useState(false);
  const [mapInitialized, setMapInitialized] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [activeLayer, setActiveLayer] = useState<LayerKey>('map');
  const [showAirspace, setShowAirspace] = useState(false);
  const [activeChart, setActiveChart] = useState<ChartOverlayKey | null>(null);
  const fullscreenBtnRef = useRef<View>(null);
  const fitRouteBtnRef = useRef<View>(null);
  const fetchingRef = useRef(false);
  const routeBoundsRef = useRef<L.LatLngBounds | null>(null);
  const [hasRoute, setHasRoute] = useState(false);

  // Stable refs for callbacks
  const onSelectOriginRef = useRef(onSelectOrigin);
  onSelectOriginRef.current = onSelectOrigin;
  const onSelectDestRef = useRef(onSelectDestination);
  onSelectDestRef.current = onSelectDestination;
  const onSelectAltRef = useRef(onSelectAlternate);
  onSelectAltRef.current = onSelectAlternate;
  const onAddWpRef = useRef(onAddWaypoint);
  onAddWpRef.current = onAddWaypoint;
  const onRemoveWpRef = useRef(onRemoveWaypoint);
  onRemoveWpRef.current = onRemoveWaypoint;
  const onUpdateWpRef = useRef(onUpdateWaypoint);
  onUpdateWpRef.current = onUpdateWaypoint;
  const wpCountRef = useRef(routeWaypoints?.length ?? 0);
  wpCountRef.current = routeWaypoints?.length ?? 0;
  const tRef = useRef(t);
  tRef.current = t;

  // CSS injection + ready
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    injectLeafletCSS();
    const timer = setTimeout(() => setReady(true), 100);
    return () => clearTimeout(timer);
  }, []);

  // Fullscreen change listener
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const doc = (globalThis as Record<string, unknown>).document as DomDocument;
    const handler = () => {
      const isFull = !!doc.fullscreenElement;
      setIsFullscreen(isFull);
      setTimeout(() => mapRef.current?.invalidateSize(), 150);
    };
    doc.addEventListener('fullscreenchange', handler);
    return () => doc.removeEventListener('fullscreenchange', handler);
  }, []);

  const toggleFullscreen = useCallback(() => {
    const el = wrapperRef.current as unknown as DomElement | null;
    if (!el) return;
    const doc = (globalThis as Record<string, unknown>).document as DomDocument;
    if (doc.fullscreenElement) {
      doc.exitFullscreen();
    } else {
      el.requestFullscreen?.();
    }
  }, []);

  // Initialize Leaflet map
  useEffect(() => {
    if (!ready || Platform.OS !== 'web') return;

    const Leaf = require('leaflet') as LeafletModule;
    const el = containerRef.current as unknown as DomElement | null;
    if (!el || mapRef.current) return;

    const map = Leaf.map(el, { zoomControl: true }).setView(DEFAULT_CENTER, DEFAULT_ZOOM);

    // Custom pane for route elements (below default markerPane z-index 600)
    const routePane = map.createPane('routeLabels');
    (routePane as unknown as DomElement).style['zIndex'] = '450';

    const defaultTile = TILE_LAYERS.map;
    tileLayerRef.current = Leaf.tileLayer(defaultTile.url, { attribution: defaultTile.attr, maxZoom: 18, crossOrigin: 'anonymous' }).addTo(map);
    mapRef.current = map;
    setMapInitialized(true);

    // Fetch airports on move
    let debounce: ReturnType<typeof setTimeout>;
    const loadAirports = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => void fetchAndRender(map, Leaf), 400);
    };

    map.on('moveend', loadAirports);
    map.on('zoomend', loadAirports);

    // Context menu — right-click to add waypoint
    map.on('contextmenu', (e: L.LeafletMouseEvent) => {
      const { lat, lng } = e.latlng;
      const wpNum = wpCountRef.current + 1;
      const defaultName = `WPT${String(wpNum).padStart(2, '0')}`;

      const popupHtml = `
        <div style="font-family:system-ui,sans-serif;min-width:170px">
          <div style="font-weight:600;font-size:11px;margin-bottom:6px;color:#6b7280">
            ${lat.toFixed(4)}, ${lng.toFixed(4)}
          </div>
          <input id="wp-name-input" type="text" value="${defaultName}"
            style="width:100%;padding:4px 6px;border:1px solid #d1d5db;border-radius:4px;font-size:12px;margin-bottom:6px;box-sizing:border-box;font-weight:600" />
          <button data-action="add-waypoint"
            style="width:100%;padding:6px 4px;background:${ROUTE_COLOR};color:#fff;border:none;border-radius:4px;font-size:11px;font-weight:600;cursor:pointer">
            + ${escapeHtml(tRef.current('vfr.addWaypoint'))}
          </button>
        </div>
      `;

      const popup = Leaf.popup({ closeButton: true }).setLatLng(e.latlng).setContent(popupHtml).openOn(map);
      const popupEl = popup.getElement() as unknown as DomElement | undefined;
      if (popupEl) {
        const btn = popupEl.querySelector?.('button[data-action="add-waypoint"]');
        btn?.addEventListener('click', () => {
          const nameInput = popupEl.querySelector?.('#wp-name-input');
          const name = (nameInput?.value as string | undefined)?.trim() || defaultName;
          onAddWpRef.current?.({ lat, lng, name });
          map.closePopup();
        });
      }
    });

    // Initial load
    void fetchAndRender(map, Leaf);

    // Expose handle to parent
    onMapReady?.({
      flyTo: (lat: number, lng: number) => {
        map.flyTo([lat, lng], 13, { duration: 1.2 });
      },
      getContainer: () => map.getContainer(),
      fitRouteBounds: () => {
        if (!routeBoundsRef.current) return null;
        const prev = { center: [map.getCenter().lat, map.getCenter().lng] as [number, number], zoom: map.getZoom() };
        map.fitBounds(routeBoundsRef.current, { padding: [40, 40], animate: false });
        return prev;
      },
      setView: (center: [number, number], zoom: number) => {
        map.setView(center, zoom, { animate: false });
      },
    });

    return () => {
      map.off('moveend', loadAirports);
      map.off('zoomend', loadAirports);
      map.off('contextmenu');
      map.remove();
      mapRef.current = null;
      setMapInitialized(false);
    };
  }, [ready]);

  // Switch tile layer
  useEffect(() => {
    if (!mapRef.current || Platform.OS !== 'web') return;
    const Leaf = require('leaflet') as LeafletModule;
    const map = mapRef.current;
    const layer = TILE_LAYERS[activeLayer];
    if (tileLayerRef.current) map.removeLayer(tileLayerRef.current);
    tileLayerRef.current = Leaf.tileLayer(layer.url, { attribution: layer.attr, maxZoom: 18, crossOrigin: 'anonymous' }).addTo(map);
  }, [activeLayer]);

  // Toggle OpenAIP airspace overlay
  useEffect(() => {
    if (!mapRef.current || Platform.OS !== 'web') return;
    const Leaf = require('leaflet') as LeafletModule;
    const map = mapRef.current;

    if (showAirspace && !openAipLayerRef.current) {
      openAipLayerRef.current = Leaf.tileLayer(OPENAIP_TILE_URL, {
        maxZoom: 14,
        minZoom: 4,
        opacity: 0.65,
        crossOrigin: 'anonymous',
        attribution: '&copy; <a href="https://www.openaip.net">OpenAIP</a>',
      }).addTo(map);
    } else if (!showAirspace && openAipLayerRef.current) {
      map.removeLayer(openAipLayerRef.current);
      openAipLayerRef.current = null;
    }
  }, [showAirspace]);

  // DECEA WMS chart overlay (mutually exclusive — only one active at a time)
  useEffect(() => {
    if (!mapRef.current || Platform.OS !== 'web') return;
    const Leaf = require('leaflet') as LeafletModule;
    const map = mapRef.current;

    // Remove all existing chart layers
    for (const k of Object.keys(chartLayersRef.current)) {
      const layer = chartLayersRef.current[k];
      if (layer) map.removeLayer(layer);
    }
    chartLayersRef.current = {};

    // Add the active one
    if (activeChart) {
      const cfg = DECEA_CHART_OVERLAYS[activeChart];
      chartLayersRef.current[activeChart] = Leaf.tileLayer.wms(DECEA_WMS_BASE, {
        layers: cfg.layers,
        format: 'image/png',
        transparent: true,
        version: '1.1.1',
        opacity: cfg.opacity,
        minZoom: cfg.minZoom,
        maxZoom: cfg.maxZoom,
        attribution: '&copy; DECEA/ICA',
      }).addTo(map);
    }
  }, [activeChart]);

  // ResizeObserver — invalidate map size when container resizes (sidebar collapse, etc.)
  useEffect(() => {
    if (Platform.OS !== 'web' || !ready) return;
    const el = wrapperRef.current as unknown as DomElement | null;
    const RO = (globalThis as Record<string, unknown>).ResizeObserver as (new (cb: () => void) => { observe(el: unknown): void; disconnect(): void }) | undefined;
    if (!el || !RO) return;
    const observer = new RO(() => {
      setTimeout(() => mapRef.current?.invalidateSize(), 50);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ready]);

  const fitToRoute = useCallback(() => {
    if (mapRef.current && routeBoundsRef.current) {
      mapRef.current.fitBounds(routeBoundsRef.current, { padding: [40, 40], maxZoom: 12 });
    }
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const fsEl = fullscreenBtnRef.current as unknown as DomElement | null;
    if (fsEl) fsEl.title = t(isFullscreen ? 'vfr.exitFullscreen' : 'vfr.fullscreen');
    const frEl = fitRouteBtnRef.current as unknown as DomElement | null;
    if (frEl) frEl.title = t('vfr.fitRoute');
  }, [isFullscreen, t]);

  const toggleChart = useCallback((key: ChartOverlayKey) => {
    setActiveChart((prev) => (prev === key ? null : key));
  }, []);

  const visibleChartKeys = useMemo(() => {
    const all = Object.keys(DECEA_CHART_OVERLAYS) as ChartOverlayKey[];
    if (flightRules === 'VFR') return all.filter((k) => k !== 'enrcL' && k !== 'enrcH');
    if (flightRules === 'IFR') return all.filter((k) => k !== 'rea' && k !== 'wac');
    return all;
  }, [flightRules]);

  useEffect(() => {
    if (activeChart && !visibleChartKeys.includes(activeChart)) {
      setActiveChart(null);
    }
  }, [visibleChartKeys, activeChart]);

  // WMS GetFeatureInfo on click — shows popup with feature details when airspace layer is active
  useEffect(() => {
    if (!mapRef.current || Platform.OS !== 'web') return;
    const Leaf = require('leaflet') as LeafletModule;
    const map = mapRef.current;

    if (activeChart !== 'airspaceDecea') return;

    const handleClick = async (e: L.LeafletMouseEvent) => {
      const { lat, lng } = e.latlng;
      const bounds = map.getBounds();
      const size = map.getSize();
      const point = map.latLngToContainerPoint(e.latlng);

      const layers = DECEA_CHART_OVERLAYS.airspaceDecea.layers;
      const params = new URLSearchParams({
        service: 'WMS',
        version: '1.1.1',
        request: 'GetFeatureInfo',
        layers,
        query_layers: layers,
        info_format: 'application/json',
        x: String(Math.round(point.x)),
        y: String(Math.round(point.y)),
        width: String(size.x),
        height: String(size.y),
        bbox: `${bounds.getWest()},${bounds.getSouth()},${bounds.getEast()},${bounds.getNorth()}`,
        srs: 'EPSG:4326',
        feature_count: '5',
      });

      try {
        const wmsUrl = `${DECEA_WMS_BASE}?${params}`;
        const data = await apiClient.get<WmsFeatureInfoResponse>(`/aerodromes/wms-proxy?url=${encodeURIComponent(wmsUrl)}`);
        const features = data?.features;
        if (!features || features.length === 0) return;

        const html = features.map((f: WmsFeature) => {
          const p = f.properties ?? {};
          const typ = p.typ ?? '';
          const name = p.nam ?? p.ident ?? '';
          const upper = p.upperlimit != null ? `${p.upperlimit} ${p.uplimituni ?? ''}`.trim() : '';
          const lower = p.lowerlimi1 != null ? `${p.lowerlimi1} ${p.lowerlimit ?? ''}`.trim() : (p.codedistv1 ?? '');
          const fir = p.relatedfir ?? '';
          return `
            <div style="margin-bottom:6px;padding-bottom:6px;border-bottom:1px solid #e5e7eb;font-family:system-ui,sans-serif">
              <div style="font-weight:700;font-size:12px;color:#1e293b">${escapeHtml(typ)} — ${escapeHtml(name)}</div>
              ${upper || lower ? `<div style="font-size:11px;color:#475569;margin-top:2px">${escapeHtml(lower)} → ${escapeHtml(upper)}</div>` : ''}
              ${fir ? `<div style="font-size:10px;color:#94a3b8;margin-top:1px">FIR: ${escapeHtml(fir)}</div>` : ''}
            </div>`;
        }).join('');

        Leaf.popup({ maxWidth: 300 })
          .setLatLng([lat, lng])
          .setContent(`<div style="max-height:200px;overflow-y:auto">${html}</div>`)
          .openOn(map);
      } catch { /* best-effort */ }
    };

    map.on('click', handleClick);
    return () => { map.off('click', handleClick); };
  }, [activeChart]);

  // Route rendering — redraws when waypoints / origin / destination change
  // Serialize waypoints for stable dependency (array reference may not change on re-render)
  const waypointsKey = routeWaypoints ? routeWaypoints.map((w) => `${w.lat},${w.lng}`).join(';') : '';

  useEffect(() => {
    if (!mapRef.current || Platform.OS !== 'web') return;
    const Leaf = require('leaflet') as LeafletModule;
    const map = mapRef.current;

    // Clear previous route layer
    if (routeLayerRef.current) {
      map.removeLayer(routeLayerRef.current);
      routeLayerRef.current = null;
    }

    // Build full route: origin → intermediate waypoints → destination (always in this order)
    const fullRoute: { lat: number; lng: number; name: string; isIntermediate: boolean }[] = [];

    // 1. Origin is always first
    if (routeOrigin) fullRoute.push({ ...routeOrigin, isIntermediate: false });

    // 2. Intermediate waypoints in the middle
    if (routeWaypoints && routeWaypoints.length > 0) {
      for (const wp of routeWaypoints) fullRoute.push({ ...wp, isIntermediate: true });
    }

    // 3. Destination is always last (never before waypoints)
    if (routeDestination) fullRoute.push({ ...routeDestination, isIntermediate: false });

    if (fullRoute.length < 2) return;

    const group = Leaf.layerGroup().addTo(map);

    // Route polyline — emblems (white-filled, higher z-index) cover the line ends
    const routeLatlngs = fullRoute.map((p) => [p.lat, p.lng] as L.LatLngTuple);
    const outlinePoly = Leaf.polyline(routeLatlngs, { color: ROUTE_OUTLINE, weight: 8, opacity: 0.6, lineCap: 'butt', lineJoin: 'round' }).addTo(group);
    const mainPoly = Leaf.polyline(routeLatlngs, { color: ROUTE_COLOR, weight: 5, opacity: 0.85, lineCap: 'butt', lineJoin: 'round' }).addTo(group);

    // Mutable copy of route positions for live drag updates
    const livePositions = fullRoute.map((p) => [p.lat, p.lng] as [number, number]);
    const originOffset = routeOrigin ? 1 : 0;

    // Airport emblem SVG — circle with tick marks (standard chart symbol)
    const airportEmblem = (color: string, size: number) => {
      const s = size;
      const c = s / 2;
      const r = s / 2 - 2;
      const t = 4;
      return `<svg width="${s}" height="${s}" viewBox="0 0 ${s} ${s}" xmlns="http://www.w3.org/2000/svg">` +
        `<circle cx="${c}" cy="${c}" r="${r}" fill="#fff" stroke="${color}" stroke-width="2.5"/>` +
        `<line x1="${c}" y1="${c - r}" x2="${c}" y2="${c - r + t}" stroke="${color}" stroke-width="2" stroke-linecap="round"/>` +
        `<line x1="${c}" y1="${c + r}" x2="${c}" y2="${c + r - t}" stroke="${color}" stroke-width="2" stroke-linecap="round"/>` +
        `<line x1="${c - r}" y1="${c}" x2="${c - r + t}" y2="${c}" stroke="${color}" stroke-width="2" stroke-linecap="round"/>` +
        `<line x1="${c + r}" y1="${c}" x2="${c + r - t}" y2="${c}" stroke="${color}" stroke-width="2" stroke-linecap="round"/>` +
        `</svg>`;
    };

    // Airport emblems at origin and destination
    const emblemSize = 22;
    if (routeOrigin) {
      const oIcon = Leaf.divIcon({
        className: 'leg-label-tooltip',
        html: airportEmblem(ROUTE_COLOR, emblemSize),
        iconSize: [emblemSize, emblemSize] as L.PointTuple,
        iconAnchor: [emblemSize / 2, emblemSize / 2] as L.PointTuple,
      });
      Leaf.marker([routeOrigin.lat, routeOrigin.lng], { icon: oIcon, interactive: false, pane: 'routeLabels' }).addTo(group);
    }
    if (routeDestination) {
      const dIcon = Leaf.divIcon({
        className: 'leg-label-tooltip',
        html: airportEmblem(ROUTE_COLOR, emblemSize),
        iconSize: [emblemSize, emblemSize] as L.PointTuple,
        iconAnchor: [emblemSize / 2, emblemSize / 2] as L.PointTuple,
      });
      Leaf.marker([routeDestination.lat, routeDestination.lng], { icon: dIcon, interactive: false, pane: 'routeLabels' }).addTo(group);
    }

    // Waypoint diamond SVG — proper centered diamond
    const diamondSvg = (stroke: string) =>
      `<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">` +
      `<path d="M8 1 L15 8 L8 15 L1 8 Z" fill="#fff" stroke="${stroke}" stroke-width="2"/>` +
      `</svg>`;

    // Leg info labels — dark pill at midpoint, rotated along bearing
    const legLabelMarkers: L.Marker[] = [];

    const buildLegPillHtml = (fromLat: number, fromLng: number, toLat: number, toLng: number) => {
      const dist = haversineDistanceNm(fromLat, fromLng, toLat, toLng);
      const tc = initialBearing(fromLat, fromLng, toLat, toLng);
      const midLat = (fromLat + toLat) / 2;
      const midLng = (fromLng + toLng) / 2;
      const decl = getMagneticDeclination(midLat, midLng);
      const mc = ((tc - decl) % 360 + 360) % 360;
      let rot = tc - 90;
      if (rot > 90) rot -= 180;
      if (rot < -90) rot += 180;
      return { midLat, midLng, html: `<div style="display:inline-block;transform:translate(-50%,-50%)"><div style="transform:rotate(${rot.toFixed(1)}deg);background:${ROUTE_OUTLINE};color:#fff;padding:3px 8px;border-radius:4px;font-size:11px;font-weight:700;white-space:nowrap;letter-spacing:0.2px;font-family:system-ui,sans-serif;text-align:center;line-height:1">${dist.toFixed(0)}NM ${mc.toFixed(0)}&deg;</div></div>` };
    };

    for (let i = 0; i < fullRoute.length - 1; i++) {
      const from = fullRoute[i]!;
      const to = fullRoute[i + 1]!;
      const { midLat, midLng, html } = buildLegPillHtml(from.lat, from.lng, to.lat, to.lng);
      const labelIcon = Leaf.divIcon({
        className: 'leg-label-tooltip route-leg-pill',
        html,
        iconSize: [0, 0] as L.PointTuple,
        iconAnchor: [0, 0] as L.PointTuple,
      });
      legLabelMarkers.push(Leaf.marker([midLat, midLng], { icon: labelIcon, interactive: false, pane: 'routeLabels' }).addTo(group));
    }

    // Helper to update a leg label during drag
    const updateLegLabel = (legIdx: number) => {
      const lm = legLabelMarkers[legIdx];
      const fromPos = livePositions[legIdx];
      const toPos = livePositions[legIdx + 1];
      if (!lm || !fromPos || !toPos) return;
      const { midLat, midLng, html } = buildLegPillHtml(fromPos[0], fromPos[1], toPos[0], toPos[1]);
      lm.setLatLng([midLat, midLng]);
      const el = lm.getElement() as unknown as DomElement | null;
      if (el) el.innerHTML = html;
    };

    // Waypoint markers — diamond + name label above
    const nameLabelMarkers: L.Marker[] = [];
    if (routeWaypoints) {
      routeWaypoints.forEach((wp, wpIdx) => {
        const nameIcon = Leaf.divIcon({
          className: 'leg-label-tooltip',
          html: `<div style="transform:translate(-50%,-100%);margin-top:-8px"><div style="display:inline-flex;align-items:center;gap:4px;background:rgba(76,29,149,0.55);color:#fff;font-size:11px;font-weight:700;padding:3px 7px;border-radius:4px;white-space:nowrap;font-family:system-ui,sans-serif;line-height:1;letter-spacing:0.4px;border:1px solid rgba(255,255,255,0.12)"><span style="width:8px;height:8px;border-radius:4px;background:${ROUTE_COLOR};flex-shrink:0"></span>${escapeHtml(wp.name)}</div><div style="width:0;height:0;border-left:4px solid transparent;border-right:4px solid transparent;border-top:4px solid rgba(76,29,149,0.55);margin:0 auto"></div></div>`,
          iconSize: [0, 0] as L.PointTuple,
          iconAnchor: [0, 0] as L.PointTuple,
        });
        const nameMarker = Leaf.marker([wp.lat, wp.lng], { icon: nameIcon, interactive: false, pane: 'routeLabels' }).addTo(group);
        nameLabelMarkers.push(nameMarker);

        // Diamond marker
        const icon = Leaf.divIcon({
          className: 'leg-label-tooltip',
          html: diamondSvg(ROUTE_COLOR),
          iconSize: [16, 16] as L.PointTuple,
          iconAnchor: [8, 8] as L.PointTuple,
        });
        const marker = Leaf.marker([wp.lat, wp.lng], { icon, pane: 'routeLabels', draggable: true }).addTo(group);
        const mEl = marker.getElement() as unknown as DomElement | null;
        if (mEl) mEl.style['cursor'] = 'move';

        marker.on('drag', () => {
          const pos = marker.getLatLng();
          const fi = wpIdx + originOffset;
          livePositions[fi] = [pos.lat, pos.lng];
          outlinePoly.setLatLngs(livePositions);
          mainPoly.setLatLngs(livePositions);
          nameLabelMarkers[wpIdx]?.setLatLng(pos);
          if (fi > 0) updateLegLabel(fi - 1);
          if (fi < livePositions.length - 1) updateLegLabel(fi);
        });

        marker.on('dragend', () => {
          const pos = marker.getLatLng();
          onUpdateWpRef.current?.(wpIdx, { lat: pos.lat, lng: pos.lng, name: wp.name });
        });

        marker.on('contextmenu', (e: L.LeafletMouseEvent) => {
          Leaf.DomEvent.stopPropagation(e);
          const pos = marker.getLatLng();
          const popup = Leaf.popup({ closeButton: true, minWidth: 140 }).setLatLng(pos).setContent(`
            <div style="font-family:system-ui,sans-serif;min-width:140px">
              <div style="font-weight:700;font-size:12px;margin-bottom:2px;color:#1a1d26">${escapeHtml(wp.name)}</div>
              <div style="font-size:10px;color:#6b7280;margin-bottom:8px">${pos.lat.toFixed(4)}, ${pos.lng.toFixed(4)}</div>
              <div style="display:flex;gap:6px">
                <button data-action="sat-wp"
                  style="flex:1;display:inline-flex;align-items:center;justify-content:center;gap:4px;padding:5px 4px;background:#4f46e5;color:#fff;border:none;border-radius:4px;font-size:11px;font-weight:600;cursor:pointer">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>
                  Satélite
                </button>
                <button data-action="remove-wp"
                  style="flex:1;display:inline-flex;align-items:center;justify-content:center;gap:4px;padding:5px 4px;background:#dc2626;color:#fff;border:none;border-radius:4px;font-size:11px;font-weight:600;cursor:pointer">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                  ${escapeHtml(tRef.current('vfr.removeWaypoint'))}
                </button>
              </div>
            </div>
          `).openOn(map);
          const popupEl = popup.getElement() as unknown as DomElement | undefined;
          if (popupEl) {
            popupEl.querySelector?.('button[data-action="remove-wp"]')?.addEventListener('click', () => {
              onRemoveWpRef.current?.(wpIdx);
              map.closePopup();
            });
            popupEl.querySelector?.('button[data-action="sat-wp"]')?.addEventListener('click', () => {
              const curPos = marker.getLatLng();
              const satUrl = buildSatelliteUrl(curPos.lat, curPos.lng, 0.08, 320, 200);
              map.closePopup();
              Leaf.popup({ closeButton: true, maxWidth: 360 })
                .setLatLng(curPos)
                .setContent(`
                  <div style="font-family:system-ui,sans-serif;min-width:320px">
                    <div style="font-weight:700;font-size:12px;margin-bottom:2px;color:#1a1d26">${escapeHtml(wp.name)}</div>
                    <div style="font-size:10px;color:#6b7280;margin-bottom:6px">${curPos.lat.toFixed(4)}, ${curPos.lng.toFixed(4)}</div>
                    <img src="${satUrl}" style="width:320px;height:200px;border-radius:4px;border:1px solid #e5e7eb;object-fit:cover;display:block" />
                  </div>
                `)
                .openOn(map);
            });
          }
        });
      });
    }

    // Alternate route — same pattern
    interface AltLegInfo { from: L.LatLngTuple; to: L.LatLngTuple; marker: L.Marker }
    const altLegLabels: AltLegInfo[] = [];
    if (routeDestination && routeAlternate) {
      const altLatlngs: L.LatLngTuple[] = [[routeDestination.lat, routeDestination.lng], [routeAlternate.lat, routeAlternate.lng]];
      Leaf.polyline(altLatlngs, { color: ALT_ROUTE_OUTLINE, weight: 8, opacity: 0.6, lineCap: 'butt', lineJoin: 'round' }).addTo(group);
      Leaf.polyline(altLatlngs, { color: ALT_ROUTE_COLOR, weight: 5, opacity: 0.85, lineCap: 'butt', lineJoin: 'round' }).addTo(group);

      const altEmblemIcon = Leaf.divIcon({
        className: 'leg-label-tooltip',
        html: airportEmblem(ALT_ROUTE_COLOR, emblemSize),
        iconSize: [emblemSize, emblemSize] as L.PointTuple,
        iconAnchor: [emblemSize / 2, emblemSize / 2] as L.PointTuple,
      });
      Leaf.marker([routeAlternate.lat, routeAlternate.lng], { icon: altEmblemIcon, interactive: false, pane: 'routeLabels' }).addTo(group);

      const { midLat: altMidLat, midLng: altMidLng, html: altHtml } = buildLegPillHtml(routeDestination.lat, routeDestination.lng, routeAlternate.lat, routeAlternate.lng);
      const altLabelIcon = Leaf.divIcon({
        className: 'leg-label-tooltip route-leg-pill',
        html: altHtml.replace(ROUTE_OUTLINE, ALT_ROUTE_OUTLINE),
        iconSize: [0, 0] as L.PointTuple,
        iconAnchor: [0, 0] as L.PointTuple,
      });
      const altM = Leaf.marker([altMidLat, altMidLng], { icon: altLabelIcon, interactive: false, pane: 'routeLabels' }).addTo(group);
      altLegLabels.push({ from: [routeDestination.lat, routeDestination.lng], to: [routeAlternate.lat, routeAlternate.lng], marker: altM });
    }

    // TOC / TOD markers
    if (tocTodPositions && tocTodPositions.length > 0) {
      for (const tp of tocTodPositions) {
        const isToc = tp.label === 'TOC';
        const color = isToc ? '#16a34a' : '#dc2626';
        const bg = isToc ? 'rgba(22,163,74,0.9)' : 'rgba(220,38,38,0.9)';
        const icon = Leaf.divIcon({
          className: 'leg-label-tooltip',
          html: `<div style="display:flex;flex-direction:column;align-items:center;transform:translate(-50%,-100%)">` +
            `<div style="background:${bg};color:#fff;padding:2px 6px;border-radius:3px;font-size:10px;font-weight:700;font-family:system-ui,sans-serif;letter-spacing:0.5px;white-space:nowrap">${tp.label}</div>` +
            `<div style="width:2px;height:8px;background:${color}"></div>` +
            `<div style="width:6px;height:6px;border-radius:50%;background:${color}"></div>` +
            `</div>`,
          iconSize: [0, 0] as L.PointTuple,
          iconAnchor: [0, 0] as L.PointTuple,
        });
        Leaf.marker([tp.lat, tp.lng], { icon, interactive: false, pane: 'routeLabels' }).addTo(group);
      }
    }

    routeLayerRef.current = group;

    const allPoints: L.LatLngTuple[] = [...fullRoute.map((p) => [p.lat, p.lng] as L.LatLngTuple)];
    if (routeAlternate) allPoints.push([routeAlternate.lat, routeAlternate.lng]);
    routeBoundsRef.current = allPoints.length >= 2 ? Leaf.latLngBounds(allPoints) : null;
    setHasRoute(!!routeBoundsRef.current);

    const LABEL_BOX_PX = 55;
    const allLegLabels = [
      ...livePositions.slice(0, -1).map((_, i) => ({
        from: livePositions[i]! as L.LatLngTuple,
        to: livePositions[i + 1]! as L.LatLngTuple,
        marker: legLabelMarkers[i]!,
      })),
      ...altLegLabels,
    ];
    const updateLabelVisibility = () => {
      for (const leg of allLegLabels) {
        if (!leg.marker) continue;
        const pxFrom = map.latLngToContainerPoint(leg.from);
        const pxTo = map.latLngToContainerPoint(leg.to);
        const linePx = Math.sqrt((pxTo.x - pxFrom.x) ** 2 + (pxTo.y - pxFrom.y) ** 2);
        const el = (leg.marker as unknown as { _icon?: { style: { display: string } } })._icon;
        if (el) {
          el.style.display = LABEL_BOX_PX > linePx * 0.7 ? 'none' : '';
        }
      }
    };
    updateLabelVisibility();
    map.on('zoomend', updateLabelVisibility);

    return () => {
      map.off('zoomend', updateLabelVisibility);
      if (routeLayerRef.current) {
        map.removeLayer(routeLayerRef.current);
        routeLayerRef.current = null;
      }
      routeBoundsRef.current = null;
      setHasRoute(false);
    };
  }, [routeOrigin, routeDestination, routeAlternate, waypointsKey, tocTodPositions, mapInitialized]);

  // REA corridor overlay
  const reaKey = reaSegments ? reaSegments.map((s) => `${s.nome}:${s.trecho}`).join(';') : '';

  useEffect(() => {
    if (!mapRef.current || Platform.OS !== 'web') return;
    const Leaf = require('leaflet') as LeafletModule;
    const map = mapRef.current;

    if (reaLayerRef.current) {
      map.removeLayer(reaLayerRef.current);
      reaLayerRef.current = null;
    }

    if (!reaSegments || reaSegments.length === 0) return;

    const group = Leaf.layerGroup().addTo(map);

    for (const seg of reaSegments) {
      const isMandatory = seg.tipo === 'Obrig';
      const isSelected = selectedReaCorridorName != null && seg.nome === selectedReaCorridorName;
      const color = isSelected ? '#16a34a' : isMandatory ? '#dc2626' : '#2563eb';
      const fillColor = isSelected ? '#86efac' : isMandatory ? '#fca5a5' : '#93c5fd';

      // Convert GeoJSON coordinates to Leaflet-compatible [lat, lng] arrays
      const coordSets = seg.geometry.type === 'MultiPolygon'
        ? (seg.geometry.coordinates as number[][][][]).map((poly) => poly[0]!)
        : [seg.geometry.coordinates[0] as number[][]];

      for (const ring of coordSets) {
        const latlngs = ring.map((c: number[]) => [c[1]!, c[0]!] as L.LatLngTuple);
        const polygon = Leaf.polygon(latlngs, {
          color,
          weight: isSelected ? 3 : 1.5,
          fillColor,
          fillOpacity: isSelected ? 0.35 : 0.2,
          dashArray: isSelected ? undefined : isMandatory ? undefined : '5,5',
        }).addTo(group);

        const altInfo = seg.altMinAtoB && seg.altMaxAtoB
          ? `${seg.altMinAtoB}-${seg.altMaxAtoB} ft`
          : '';
        polygon.bindPopup(`
          <div style="font-family:system-ui,sans-serif;min-width:160px">
            <div style="font-weight:700;font-size:13px;color:${color}">${escapeHtml(seg.nome)} <span style="font-weight:400;font-size:11px">${isMandatory ? '(Obrigatória)' : '(Recomendada)'}</span></div>
            <div style="font-size:11px;color:#6b7280;margin-top:2px">${escapeHtml(seg.fixoA.nome)} → ${escapeHtml(seg.fixoB.nome)}</div>
            ${altInfo ? `<div style="font-size:11px;margin-top:2px">Alt: ${altInfo}</div>` : ''}
            ${seg.fca ? `<div style="font-size:10px;color:#9ca3af;margin-top:2px">FCA: ${escapeHtml(seg.fca)}</div>` : ''}
          </div>
        `);
      }
    }

    reaLayerRef.current = group;

    return () => {
      if (reaLayerRef.current) {
        map.removeLayer(reaLayerRef.current);
        reaLayerRef.current = null;
      }
    };
  }, [reaKey, selectedReaCorridorName]);

  const fetchAndRender = useCallback(async (map: L.Map, Leaf: LeafletModule) => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;

    try {
      const b = map.getBounds();
      const bounds = { south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() };

      const data = await apiClient.get<Aerodrome[]>(
        `/aerodromes/map?south=${bounds.south}&west=${bounds.west}&north=${bounds.north}&east=${bounds.east}`,
      );

      let enriched: MapAerodrome[] = data.map((a) => ({ ...a, flightCategory: null }));
      if (data.length > 0 && data.length <= MAX_METAR_FETCH) {
        try {
          const icaos = data.map((a) => a.icao).join(',');
          const metars = await apiClient.get<ParsedMetar[]>(`/weather/metar?icaos=${icaos}`);
          const metarMap = new Map(metars.map((m) => [m.icaoId, m.flightCategory]));
          enriched = data.map((a) => ({ ...a, flightCategory: metarMap.get(a.icao) ?? null }));
        } catch { /* best-effort */ }
      }

      // Clear old markers
      for (const m of markersRef.current) map.removeLayer(m);
      markersRef.current = [];

      const zoom = map.getZoom();
      const filtered = enriched.filter((a) => {
        if (zoom >= 10) return true;
        if (zoom >= 8) return a.type !== 'heliport' && a.type !== 'closed';
        if (zoom >= 6) return a.type === 'large_airport' || a.type === 'medium_airport';
        return a.type === 'large_airport';
      });

      // Add new markers
      for (const airport of filtered) {
        const color = airport.flightCategory
          ? (CATEGORY_COLORS[airport.flightCategory] ?? DEFAULT_DOT_COLOR)
          : DEFAULT_DOT_COLOR;
        const bgColor = airport.flightCategory
          ? (CATEGORY_BG_COLORS[airport.flightCategory] ?? DEFAULT_BADGE_BG)
          : DEFAULT_BADGE_BG;

        const icon = Leaf.divIcon({
          className: '',
          html: `<div style="transform:translate(-50%,-100%);margin-top:-10px"><div style="display:inline-flex;align-items:center;gap:4px;background:${bgColor};color:#fff;font-size:11px;font-weight:700;padding:3px 7px;border-radius:4px;white-space:nowrap;cursor:pointer;font-family:system-ui,sans-serif;line-height:1;letter-spacing:0.4px;border:1px solid rgba(255,255,255,0.12)"><span style="width:8px;height:8px;border-radius:4px;background:${color};flex-shrink:0"></span>${escapeHtml(airport.icao)}</div><div style="width:0;height:0;border-left:4px solid transparent;border-right:4px solid transparent;border-top:4px solid ${bgColor};margin:0 auto"></div></div>`,
          iconSize: [0, 0] as L.PointTuple,
          iconAnchor: [0, 0] as L.PointTuple,
        });

        const marker = Leaf.marker([airport.latitude, airport.longitude], { icon, zIndexOffset: 1000 }).addTo(map);

        marker.on('click', () => {
          const roleRefs = { origin: onSelectOriginRef, dest: onSelectDestRef, alt: onSelectAltRef };
          const popup = Leaf.popup({ maxWidth: 360 })
            .setLatLng([airport.latitude, airport.longitude])
            .setContent(buildAirportPopupHtml(airport, null, null, null, tRef.current))
            .openOn(map);

          bindPopupRoleButtons(popup, airport, map, roleRefs);

          Promise.all([
            apiClient.get<ParsedMetar[]>(`/weather/metar?icaos=${airport.icao}`).catch(() => null),
            apiClient.get<PopupAerodromeDetail>(`/aerodromes/${airport.icao}`).catch(() => null),
          ]).then(([metarData, detail]) => {
            const metar = metarData?.find((m) => m.icaoId === airport.icao) ?? null;
            const runways = detail?.runways ?? null;
            const suggestedRwy = metar && runways && typeof metar.windDirection === 'number'
              ? suggestRunwayFromWind(metar.windDirection, runways)
              : null;
            popup.setContent(buildAirportPopupHtml(airport, metar, runways, suggestedRwy, tRef.current));
            bindPopupRoleButtons(popup, airport, map, roleRefs);
          });
        });

        markersRef.current.push(marker);
      }
    } catch { /* ignore */ }
    fetchingRef.current = false;
  }, []);

  if (Platform.OS !== 'web') {
    return null;
  }

  return (
    <View
      ref={wrapperRef}
      className="overflow-hidden"
      style={{ flex: 1, height: '100%', position: 'relative', backgroundColor: '#fff' }}
    >
      <View ref={containerRef} collapsable={false} style={{ width: '100%', height: '100%' }} />

      {/* Top-right controls */}
      <View style={{ position: 'absolute', top: 10, right: 10, zIndex: 1000, alignItems: 'flex-end', gap: 4 }}>
        {/* Base layer row */}
        <View style={{ flexDirection: 'row', gap: 4 }}>
        <View
          style={{
            flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.92)', borderRadius: 4,
            borderWidth: 1, borderColor: '#dfe2e8', overflow: 'hidden',
          }}
        >
          {(Object.keys(TILE_LAYERS) as LayerKey[]).map((key) => (
            <Pressable
              key={key}
              onPress={() => setActiveLayer(key)}
              style={{
                paddingHorizontal: 8, paddingVertical: 6,
                backgroundColor: activeLayer === key ? '#2563eb' : 'transparent',
              }}
            >
              <Text style={{ fontSize: 10, fontWeight: '600', color: activeLayer === key ? '#fff' : '#374151' }}>
                {t(TILE_LAYERS[key].i18nKey)}
              </Text>
            </Pressable>
          ))}
        </View>
        {/* Fullscreen */}
        <Pressable
          ref={fullscreenBtnRef}
          onPress={toggleFullscreen}
          style={{
            backgroundColor: 'rgba(255,255,255,0.92)', borderRadius: 4,
            borderWidth: 1, borderColor: '#dfe2e8',
            width: 32, height: 32, alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Text style={{ fontSize: 16, color: '#374151' }}>{isFullscreen ? '\u2715' : '\u26F6'}</Text>
        </Pressable>
        {hasRoute ? (
          <Pressable
            ref={fitRouteBtnRef}
            onPress={fitToRoute}
            style={{
              backgroundColor: 'rgba(255,255,255,0.92)', borderRadius: 4,
              borderWidth: 1, borderColor: '#dfe2e8',
              width: 32, height: 32, alignItems: 'center', justifyContent: 'center',
            }}
          >
            <View style={{ width: 18, height: 18 }} ref={(el) => {
              if (el && Platform.OS === 'web') {
                (el as unknown as DomElement).innerHTML = '<svg viewBox="0 0 18 18" width="18" height="18"><rect x="0.5" y="1" width="3.5" height="3.5" rx="0.7" fill="#374151"/><rect x="12" y="4" width="3.5" height="3.5" rx="0.7" fill="#374151"/><rect x="2" y="12" width="3.5" height="3.5" rx="0.7" fill="#374151"/><rect x="12.5" y="12.5" width="3.5" height="3.5" rx="0.7" fill="#374151"/><line x1="4" y1="3" x2="12" y2="5.7" stroke="#374151" stroke-width="1.3" stroke-dasharray="2 1.5"/><line x1="13.7" y1="7.5" x2="5.5" y2="13.5" stroke="#374151" stroke-width="1.3" stroke-dasharray="2 1.5"/><line x1="5.5" y1="14" x2="12.5" y2="14.2" stroke="#374151" stroke-width="1.3" stroke-dasharray="2 1.5"/></svg>';
              }
            }} />
          </Pressable>
        ) : null}
        </View>

        {/* Chart overlay toggles */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 3, justifyContent: 'flex-end' }}>
          <Pressable
            onPress={() => setShowAirspace((v) => !v)}
            style={{
              backgroundColor: showAirspace ? '#2563eb' : 'rgba(255,255,255,0.92)',
              borderRadius: 4, borderWidth: 1, borderColor: '#dfe2e8',
              paddingHorizontal: 7, paddingVertical: 4,
            }}
          >
            <Text style={{ fontSize: 9, fontWeight: '600', color: showAirspace ? '#fff' : '#374151' }}>
              {t('vfr.layerAirspace')}
            </Text>
          </Pressable>
          {visibleChartKeys.map((key) => {
            const active = activeChart === key;
            return (
              <Pressable
                key={key}
                onPress={() => toggleChart(key)}
                style={{
                  backgroundColor: active ? '#2563eb' : 'rgba(255,255,255,0.92)',
                  borderRadius: 4, borderWidth: 1, borderColor: '#dfe2e8',
                  paddingHorizontal: 7, paddingVertical: 4,
                }}
              >
                <Text style={{ fontSize: 9, fontWeight: '600', color: active ? '#fff' : '#374151' }}>
                  {t(DECEA_CHART_OVERLAYS[key].i18nKey)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* Right-click hint */}
      <View
        style={{
          position: 'absolute', top: 10, left: 50, zIndex: 1000,
          backgroundColor: 'rgba(255,255,255,0.85)', borderRadius: 4,
          paddingHorizontal: 8, paddingVertical: 3,
        }}
      >
        <Text style={{ fontSize: 10, color: '#9ca3af' }}>{t('vfr.rightClickHint')}</Text>
      </View>

      {/* Legend */}
      <View
        style={{
          position: 'absolute', bottom: 8, left: 8, zIndex: 1000,
          backgroundColor: 'rgba(255,255,255,0.92)', borderRadius: 6,
          borderWidth: 1, borderColor: '#dfe2e8',
          flexDirection: 'row', gap: 10, paddingHorizontal: 10, paddingVertical: 4,
        }}
      >
        {Object.entries(CATEGORY_COLORS).map(([cat, color]) => (
          <View key={cat} style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
            <Text style={{ fontSize: 10, color: '#6b7280' }}>{cat}</Text>
          </View>
        ))}
      </View>

    </View>
  );
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// --------------- Airport popup helpers ---------------

function categoryColorHex(cat: string | null): string {
  if (!cat) return DEFAULT_DOT_COLOR;
  return CATEGORY_COLORS[cat] ?? DEFAULT_DOT_COLOR;
}

function formatPopupWind(dir: number | string | null, spd: number | null): string {
  if (dir === null || spd === null) return '—';
  if (dir === 'VRB') return `VRB ${spd}kt`;
  return `${String(dir).padStart(3, '0')}°/${spd}kt`;
}

function suggestRunwayFromWind(
  windDir: number,
  runways: PopupRunway[],
): string | null {
  const open = runways.filter((r) => !r.closed);
  if (open.length === 0) return null;
  let bestIdent: string | null = null;
  let bestHeadwind = -Infinity;
  for (const rwy of open) {
    for (const th of [
      { ident: rwy.leIdent, heading: rwy.leHeadingDeg },
      { ident: rwy.heIdent, heading: rwy.heHeadingDeg },
    ]) {
      if (!th.ident || th.heading === null) continue;
      const diff = ((windDir - th.heading + 540) % 360) - 180;
      const headwind = Math.cos((diff * Math.PI) / 180);
      if (headwind > bestHeadwind) {
        bestHeadwind = headwind;
        bestIdent = th.ident;
      }
    }
  }
  return bestIdent;
}

function buildRunwayHtml(runways: PopupRunway[], suggestedRwy: string | null, t: (key: string) => string): string {
  if (runways.length === 0) return '';

  interface ThresholdRow { ident: string; heading: number | null; lengthFt: number | null; closed: boolean; inUse: boolean }
  const thresholds: ThresholdRow[] = [];

  for (const rwy of runways) {
    if (rwy.leIdent) {
      thresholds.push({ ident: rwy.leIdent, heading: rwy.leHeadingDeg, lengthFt: rwy.lengthFt, closed: rwy.closed, inUse: rwy.leIdent === suggestedRwy });
    }
    if (rwy.heIdent) {
      thresholds.push({ ident: rwy.heIdent, heading: rwy.heHeadingDeg, lengthFt: rwy.lengthFt, closed: rwy.closed, inUse: rwy.heIdent === suggestedRwy });
    }
  }

  const rows = thresholds.map((th) => {
    const hdg = th.heading != null ? `${String(Math.round(th.heading)).padStart(3, '0')}°` : '';
    const len = th.lengthFt != null ? `${th.lengthFt} ft` : '';
    const closedTag = th.closed ? ' <span style="color:#dc2626;font-size:9px">fechada</span>' : '';
    const inUseTag = th.inUse
      ? `<span style="background:#16a34a;color:#fff;font-size:8px;font-weight:700;padding:1px 4px;border-radius:2px;margin-left:4px">${escapeHtml(t('vfr.suggested'))}</span>`
      : '';

    const rowBg = th.inUse ? 'background:#f0fdf4;border-radius:3px;' : '';

    return `<div style="display:flex;align-items:center;gap:8px;padding:2px 4px;${rowBg}">
      <span style="font-size:11px;font-weight:${th.inUse ? '700' : '500'};color:${th.inUse ? '#16a34a' : '#1e293b'};min-width:28px">${escapeHtml(th.ident)}</span>
      <span style="font-size:10px;color:#6b7280;min-width:32px">${hdg}</span>
      <span style="font-size:10px;color:#6b7280">${len}</span>
      ${closedTag}${inUseTag}
    </div>`;
  }).join('');

  return `
    <div style="margin:4px 0 6px;padding:5px 8px;background:#f8fafc;border-radius:4px;border:1px solid #e2e8f0">
      <div style="font-size:9px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:3px">${escapeHtml(t('vfr.runwayInUse'))}</div>
      ${rows}
    </div>`;
}

function buildAirportPopupHtml(
  airport: MapAerodrome,
  metar: ParsedMetar | null,
  runways: PopupRunway[] | null,
  suggestedRwy: string | null,
  t: (key: string) => string,
): string {
  const catColor = categoryColorHex(metar?.flightCategory ?? airport.flightCategory ?? null);
  const cat = metar?.flightCategory ?? airport.flightCategory ?? null;

  const elevHtml = airport.elevation != null
    ? `<span style="font-size:10px;color:#6b7280;margin-left:6px">${airport.elevation} ft</span>`
    : '';

  let metarHtml: string;
  if (metar) {
    const cloudsTxt = metar.clouds.length > 0
      ? metar.clouds.map((c) => `${c.cover} ${c.base}`).join(' / ')
      : '—';

    const nearbyLabel = metar.source === 'nearby' && metar.nearbyFrom
      ? `<div style="font-size:9px;color:#d97706;font-weight:600;margin-bottom:3px">METAR ${escapeHtml(metar.nearbyFrom)} (${metar.nearbyDistanceNm ?? '?'} nm)</div>`
      : '';

    metarHtml = `
      <div style="margin:6px 0;padding:6px 8px;background:#f1f5f9;border-radius:4px;border:1px solid #e2e8f0">
        ${nearbyLabel}
        <div style="font-family:monospace;font-size:10px;color:#334155;margin-bottom:5px;word-break:break-all;line-height:1.4">${escapeHtml(metar.raw)}</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px 12px;font-size:10px;color:#475569">
          <span><b>${escapeHtml(t('vfr.wind'))}:</b> ${formatPopupWind(metar.windDirection, metar.windSpeed)}</span>
          <span><b>${escapeHtml(t('vfr.visibility'))}:</b> ${metar.visibility ?? '—'}</span>
          ${metar.ceiling != null ? `<span><b>${escapeHtml(t('vfr.ceiling'))}:</b> ${metar.ceiling} ft</span>` : ''}
          <span><b>${escapeHtml(t('vfr.qnh'))}:</b> ${metar.altimeter ?? '—'} hPa</span>
          <span><b>☁:</b> ${cloudsTxt}</span>
        </div>
      </div>`;
  } else {
    metarHtml = `<div style="margin:6px 0;font-size:10px;color:#9ca3af;font-style:italic">${escapeHtml(t('vfr.noMetar'))}</div>`;
  }

  const runwayHtml = runways ? buildRunwayHtml(runways, suggestedRwy, t) : '';

  const catBadge = cat
    ? `<span style="display:inline-block;background:${catColor};color:#fff;font-size:10px;font-weight:700;padding:1px 6px;border-radius:3px;margin-left:6px;vertical-align:middle">${cat}</span>`
    : '';

  return `
    <div style="min-width:260px;max-width:360px;font-family:system-ui,sans-serif">
      <div style="display:flex;align-items:baseline;margin-bottom:1px">
        <span style="font-weight:700;font-size:15px;color:#1a1d26">${escapeHtml(airport.icao)}</span>
        ${catBadge}${elevHtml}
      </div>
      <div style="font-size:11px;color:#6b7280;margin-bottom:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(airport.name)}</div>
      ${metarHtml}
      ${runwayHtml}
      <div style="display:flex;gap:4px">
        <button data-role="origin" style="flex:1;padding:5px 4px;background:#2563eb;color:#fff;border:none;border-radius:4px;font-size:10px;font-weight:600;cursor:pointer">
          ${escapeHtml(t('vfr.origin'))}
        </button>
        <button data-role="destination" style="flex:1;padding:5px 4px;background:#2563eb;color:#fff;border:none;border-radius:4px;font-size:10px;font-weight:600;cursor:pointer">
          ${escapeHtml(t('vfr.destination'))}
        </button>
        <button data-role="alternate" style="flex:1;padding:5px 4px;background:#2563eb;color:#fff;border:none;border-radius:4px;font-size:10px;font-weight:600;cursor:pointer">
          ${escapeHtml(t('vfr.alternate'))}
        </button>
      </div>
    </div>
  `;
}

function bindPopupRoleButtons(
  popup: L.Popup,
  airport: MapAerodrome,
  map: L.Map,
  refs: { origin: { current: ((a: Aerodrome) => void) | null }; dest: { current: ((a: Aerodrome) => void) | null }; alt: { current: ((a: Aerodrome) => void) | null } },
) {
  const popupEl = popup.getElement() as unknown as DomElement | undefined;
  if (!popupEl) return;
  const buttons = popupEl.querySelectorAll?.('button[data-role]') ?? [];
  buttons.forEach((btn: DomElement) => {
    btn.addEventListener('click', (e: DomEvent) => {
      const role = e.currentTarget?.getAttribute?.('data-role') ?? null;
      const aerodrome: Aerodrome = {
        icao: airport.icao, iata: airport.iata, name: airport.name,
        city: airport.city, country: airport.country,
        latitude: airport.latitude, longitude: airport.longitude,
        elevation: airport.elevation, type: airport.type,
      };
      if (role === 'origin') refs.origin.current?.(aerodrome);
      else if (role === 'destination') refs.dest.current?.(aerodrome);
      else if (role === 'alternate') refs.alt.current?.(aerodrome);
      map.closePopup();
    });
  });
}

// --------------- Satellite image URL ---------------

function buildSatelliteUrl(lat: number, lng: number, spanDeg: number, w: number, h: number): string {
  const aspect = h / w;
  return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export?bbox=${lng - spanDeg},${lat - spanDeg * aspect},${lng + spanDeg},${lat + spanDeg * aspect}&bboxSR=4326&size=${w},${h}&imageSR=4326&format=png&f=image`;
}

