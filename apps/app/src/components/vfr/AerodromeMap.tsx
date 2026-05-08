import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable, Text, View } from 'react-native';

import { apiClient } from '../../services/api.client';

import type { Aerodrome } from './AerodromeSearch';
import type { ParsedMetar } from './MetarDisplay';
import { type RouteWaypoint, haversineDistanceNm, initialBearing, getMagneticDeclination } from './vfrNavigation';

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

interface Props {
  onSelectOrigin: (a: Aerodrome) => void;
  onSelectDestination: (a: Aerodrome) => void;
  onSelectAlternate: (a: Aerodrome) => void;
  onMapReady?: (flyTo: (lat: number, lng: number) => void) => void;
  routeOrigin?: { lat: number; lng: number; name: string } | null;
  routeDestination?: { lat: number; lng: number; name: string } | null;
  routeAlternate?: { lat: number; lng: number; name: string } | null;
  routeWaypoints?: RouteWaypoint[];
  onAddWaypoint?: (wp: RouteWaypoint) => void;
  onRemoveWaypoint?: (index: number) => void;
  reaSegments?: ReaCorridorSegment[];
  flightRules?: 'VFR' | 'IFR' | 'VFR_IFR' | 'IFR_VFR';
}

// --------------- Constants ---------------

const CATEGORY_COLORS: Record<string, string> = {
  VFR: '#16a34a',
  MVFR: '#2563eb',
  IFR: '#dc2626',
  LIFR: '#d946ef',
};
const DEFAULT_DOT_COLOR = '#94a3b8';
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

const ROUTE_COLOR = '#7c3aed';
const ALT_ROUTE_COLOR = '#f59e0b';

// --------------- CSS injection ---------------

let cssInjected = false;
function injectLeafletCSS() {
  if (cssInjected || Platform.OS !== 'web') return;
  cssInjected = true;
  const doc = (globalThis as any).document;
  const link = doc.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
  link.crossOrigin = '';
  doc.head.appendChild(link);

  const style = doc.createElement('style');
  style.textContent = '.leg-label-tooltip { background:none !important; border:none !important; box-shadow:none !important; margin:0 !important; padding:0 !important; }';
  doc.head.appendChild(style);
}

// --------------- Component ---------------

export function AerodromeMap({
  onSelectOrigin, onSelectDestination, onSelectAlternate, onMapReady,
  routeOrigin, routeDestination, routeAlternate, routeWaypoints, onAddWaypoint, onRemoveWaypoint,
  reaSegments, flightRules,
}: Props) {
  const { t } = useTranslation();
  const wrapperRef = useRef<View>(null);
  const containerRef = useRef<View>(null);
  const mapRef = useRef<any>(null);
  const tileLayerRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const routeLayerRef = useRef<any>(null);
  const reaLayerRef = useRef<any>(null);
  const openAipLayerRef = useRef<any>(null);
  const chartLayersRef = useRef<Record<string, any>>({});
  const [ready, setReady] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [activeLayer, setActiveLayer] = useState<LayerKey>('map');
  const [showAirspace, setShowAirspace] = useState(false);
  const [activeChart, setActiveChart] = useState<ChartOverlayKey | null>(null);
  const fetchingRef = useRef(false);
  const routeBoundsRef = useRef<any>(null);
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
    const doc = (globalThis as any).document;
    const handler = () => {
      const isFull = !!doc.fullscreenElement;
      setIsFullscreen(isFull);
      setTimeout(() => mapRef.current?.invalidateSize(), 150);
    };
    doc.addEventListener('fullscreenchange', handler);
    return () => doc.removeEventListener('fullscreenchange', handler);
  }, []);

  const toggleFullscreen = useCallback(() => {
    const el = wrapperRef.current as any;
    if (!el) return;
    const doc = (globalThis as any).document;
    if (doc.fullscreenElement) {
      doc.exitFullscreen();
    } else {
      el.requestFullscreen?.();
    }
  }, []);

  // Initialize Leaflet map
  useEffect(() => {
    if (!ready || Platform.OS !== 'web') return;

    const L = require('leaflet') as any;
    const el = containerRef.current as any;
    if (!el || mapRef.current) return;

    const map = L.map(el, { zoomControl: true }).setView(DEFAULT_CENTER, DEFAULT_ZOOM);
    const defaultTile = TILE_LAYERS.map;
    tileLayerRef.current = L.tileLayer(defaultTile.url, { attribution: defaultTile.attr, maxZoom: 18 }).addTo(map);
    mapRef.current = map;

    // Fetch airports on move
    let debounce: ReturnType<typeof setTimeout>;
    const loadAirports = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => void fetchAndRender(map, L), 400);
    };

    map.on('moveend', loadAirports);
    map.on('zoomend', loadAirports);

    // Context menu — right-click to add waypoint
    map.on('contextmenu', (e: any) => {
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

      const popup = L.popup({ closeButton: true }).setLatLng(e.latlng).setContent(popupHtml).openOn(map);
      const popupEl = popup.getElement();
      if (popupEl) {
        const btn = popupEl.querySelector('button[data-action="add-waypoint"]');
        btn?.addEventListener('click', () => {
          const nameInput = popupEl.querySelector('#wp-name-input') as any;
          const name = (nameInput?.value as string)?.trim() || defaultName;
          onAddWpRef.current?.({ lat, lng, name });
          map.closePopup();
        });
      }
    });

    // Initial load
    void fetchAndRender(map, L);

    // Expose flyTo to parent
    onMapReady?.((lat: number, lng: number) => {
      map.flyTo([lat, lng], 13, { duration: 1.2 });
    });

    return () => {
      map.off('moveend', loadAirports);
      map.off('zoomend', loadAirports);
      map.off('contextmenu');
      map.remove();
      mapRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  // Switch tile layer
  useEffect(() => {
    if (!mapRef.current || Platform.OS !== 'web') return;
    const L = require('leaflet') as any;
    const map = mapRef.current;
    const layer = TILE_LAYERS[activeLayer];
    if (tileLayerRef.current) map.removeLayer(tileLayerRef.current);
    tileLayerRef.current = L.tileLayer(layer.url, { attribution: layer.attr, maxZoom: 18 }).addTo(map);
  }, [activeLayer]);

  // Toggle OpenAIP airspace overlay
  useEffect(() => {
    if (!mapRef.current || Platform.OS !== 'web') return;
    const L = require('leaflet') as any;
    const map = mapRef.current;

    if (showAirspace && !openAipLayerRef.current) {
      openAipLayerRef.current = L.tileLayer(OPENAIP_TILE_URL, {
        maxZoom: 14,
        minZoom: 4,
        transparent: true,
        opacity: 0.65,
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
    const L = require('leaflet') as any;
    const map = mapRef.current;

    // Remove all existing chart layers
    for (const k of Object.keys(chartLayersRef.current)) {
      map.removeLayer(chartLayersRef.current[k]);
    }
    chartLayersRef.current = {};

    // Add the active one
    if (activeChart) {
      const cfg = DECEA_CHART_OVERLAYS[activeChart];
      chartLayersRef.current[activeChart] = L.tileLayer.wms(DECEA_WMS_BASE, {
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeChart]);

  // ResizeObserver — invalidate map size when container resizes (sidebar collapse, etc.)
  useEffect(() => {
    if (Platform.OS !== 'web' || !ready) return;
    const el = wrapperRef.current as any;
    const RO = (globalThis as any).ResizeObserver;
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
    const L = require('leaflet') as any;
    const map = mapRef.current;

    if (activeChart !== 'airspaceDecea') return;

    const handleClick = async (e: any) => {
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
        const data = await apiClient.get<any>(`/aerodromes/wms-proxy?url=${encodeURIComponent(wmsUrl)}`);
        const features = data?.features;
        if (!features || features.length === 0) return;

        const html = features.map((f: any) => {
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

        L.popup({ maxWidth: 300 })
          .setLatLng([lat, lng])
          .setContent(`<div style="max-height:200px;overflow-y:auto">${html}</div>`)
          .openOn(map);
      } catch { /* best-effort */ }
    };

    map.on('click', handleClick);
    return () => { map.off('click', handleClick); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeChart]);

  // Route rendering — redraws when waypoints / origin / destination change
  // Serialize waypoints for stable dependency (array reference may not change on re-render)
  const waypointsKey = routeWaypoints ? routeWaypoints.map((w) => `${w.lat},${w.lng}`).join(';') : '';

  useEffect(() => {
    if (!mapRef.current || Platform.OS !== 'web') return;
    const L = require('leaflet') as any;
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

    const group = L.layerGroup().addTo(map);

    // Polyline — semi-transparent route
    const latlngs = fullRoute.map((p) => [p.lat, p.lng]);
    L.polyline(latlngs, { color: ROUTE_COLOR, weight: 9, opacity: 0.55, lineCap: 'round', lineJoin: 'round' }).addTo(group);

    // Intermediate waypoint markers (numbered circles) — hover shows visual reference
    if (routeWaypoints) {
      routeWaypoints.forEach((wp, wpIdx) => {
        const icon = L.divIcon({
          className: 'leg-label-tooltip',
          html: `<div style="width:22px;height:22px;border-radius:50%;background:${ROUTE_COLOR};color:#fff;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,0.3);cursor:pointer">${wpIdx + 1}</div>`,
          iconSize: [22, 22],
          iconAnchor: [11, 11],
        });

        const marker = L.marker([wp.lat, wp.lng], { icon }).addTo(group);

        // Hover → visual reference popup (satellite only)
        marker.on('mouseover', () => {
          const satUrl = buildSatelliteUrl(wp.lat, wp.lng, 0.08, 320, 200);
          const popupHtml = `
            <div style="font-family:system-ui,sans-serif;min-width:320px">
              <div style="font-weight:700;font-size:12px;margin-bottom:2px;color:#1a1d26">${escapeHtml(wp.name)}</div>
              <div style="font-size:10px;color:#6b7280;margin-bottom:6px">${wp.lat.toFixed(4)}, ${wp.lng.toFixed(4)}</div>
              <img src="${satUrl}" style="width:320px;height:200px;border-radius:4px;border:1px solid #e5e7eb;object-fit:cover;display:block" />
            </div>
          `;
          L.popup({ maxWidth: 360, closeButton: true, autoPan: true })
            .setLatLng([wp.lat, wp.lng])
            .setContent(popupHtml)
            .openOn(map);
        });

        // Right-click to remove waypoint
        marker.on('contextmenu', (e: any) => {
          L.DomEvent.stopPropagation(e);
          const removeHtml = `
            <div style="font-family:system-ui,sans-serif;min-width:120px">
              <div style="font-weight:700;font-size:12px;margin-bottom:2px;color:#1a1d26">${escapeHtml(wp.name)}</div>
              <div style="font-size:10px;color:#6b7280;margin-bottom:6px">${wp.lat.toFixed(4)}, ${wp.lng.toFixed(4)}</div>
              <button data-action="remove-wp"
                style="width:100%;padding:5px 4px;background:#dc2626;color:#fff;border:none;border-radius:4px;font-size:11px;font-weight:600;cursor:pointer">
                ${escapeHtml(tRef.current('vfr.removeWaypoint'))}
              </button>
            </div>
          `;
          const popup = L.popup({ closeButton: true }).setLatLng([wp.lat, wp.lng]).setContent(removeHtml).openOn(map);
          const popupEl = popup.getElement();
          if (popupEl) {
            popupEl.querySelector('button[data-action="remove-wp"]')?.addEventListener('click', () => {
              onRemoveWpRef.current?.(wpIdx);
              map.closePopup();
            });
          }
        });
      });
    }

    // Leg labels at midpoints — dark pill rotated along route bearing (Navigraph-style)
    for (let i = 0; i < fullRoute.length - 1; i++) {
      const from = fullRoute[i]!;
      const to = fullRoute[i + 1]!;
      const dist = haversineDistanceNm(from.lat, from.lng, to.lat, to.lng);
      const tc = initialBearing(from.lat, from.lng, to.lat, to.lng);
      const midLat = (from.lat + to.lat) / 2;
      const midLng = (from.lng + to.lng) / 2;
      const decl = getMagneticDeclination(midLat, midLng);
      const mc = ((tc - decl) % 360 + 360) % 360;

      let rot = tc - 90;
      if (rot > 90) rot -= 180;
      if (rot < -90) rot += 180;

      const labelIcon = L.divIcon({
        className: 'leg-label-tooltip',
        html: `<div style="display:inline-block;transform:translate(-50%,-50%)"><div style="transform:rotate(${rot.toFixed(1)}deg);background:${ROUTE_COLOR};color:#fff;padding:2px 8px;border-radius:3px;font-size:10px;font-weight:700;white-space:nowrap;letter-spacing:0.3px;font-family:system-ui,sans-serif;opacity:0.55">${dist.toFixed(0)}NM ${mc.toFixed(0)}&deg;</div></div>`,
        iconSize: [0, 0],
        iconAnchor: [0, 0],
      });
      L.marker([midLat, midLng], { icon: labelIcon, interactive: false }).addTo(group);
    }

    // Alternate route: solid line from destination to alternate
    if (routeDestination && routeAlternate) {
      const altLatlngs: [number, number][] = [[routeDestination.lat, routeDestination.lng], [routeAlternate.lat, routeAlternate.lng]];
      L.polyline(altLatlngs, { color: ALT_ROUTE_COLOR, weight: 7, opacity: 0.55, lineCap: 'round', lineJoin: 'round' }).addTo(group);

      // Alternate marker
      const altIcon = L.divIcon({
        className: '',
        html: `<div style="width:22px;height:22px;border-radius:50%;background:${ALT_ROUTE_COLOR};color:#fff;font-size:9px;font-weight:700;display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,0.3)">ALT</div>`,
        iconAnchor: [11, 11],
      });
      L.marker([routeAlternate.lat, routeAlternate.lng], { icon: altIcon }).addTo(group);

      // Leg label at midpoint
      const altDist = haversineDistanceNm(routeDestination.lat, routeDestination.lng, routeAlternate.lat, routeAlternate.lng);
      const altTc = initialBearing(routeDestination.lat, routeDestination.lng, routeAlternate.lat, routeAlternate.lng);
      const altMidLat = (routeDestination.lat + routeAlternate.lat) / 2;
      const altMidLng = (routeDestination.lng + routeAlternate.lng) / 2;
      const altDecl = getMagneticDeclination(altMidLat, altMidLng);
      const altMc = ((altTc - altDecl) % 360 + 360) % 360;

      let altRot = altTc - 90;
      if (altRot > 90) altRot -= 180;
      if (altRot < -90) altRot += 180;

      const altLabelIcon = L.divIcon({
        className: 'leg-label-tooltip',
        html: `<div style="display:inline-block;transform:translate(-50%,-50%)"><div style="transform:rotate(${altRot.toFixed(1)}deg);background:${ALT_ROUTE_COLOR};color:#fff;padding:2px 8px;border-radius:3px;font-size:10px;font-weight:700;white-space:nowrap;letter-spacing:0.3px;font-family:system-ui,sans-serif;opacity:0.55">${altDist.toFixed(0)}NM ${altMc.toFixed(0)}&deg;</div></div>`,
        iconSize: [0, 0],
        iconAnchor: [0, 0],
      });
      L.marker([altMidLat, altMidLng], { icon: altLabelIcon, interactive: false }).addTo(group);
    }

    routeLayerRef.current = group;

    const allPoints = [...fullRoute.map((p) => [p.lat, p.lng] as [number, number])];
    if (routeAlternate) allPoints.push([routeAlternate.lat, routeAlternate.lng]);
    routeBoundsRef.current = allPoints.length >= 2 ? L.latLngBounds(allPoints) : null;
    setHasRoute(!!routeBoundsRef.current);

    return () => {
      if (routeLayerRef.current) {
        map.removeLayer(routeLayerRef.current);
        routeLayerRef.current = null;
      }
      routeBoundsRef.current = null;
      setHasRoute(false);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeOrigin, routeDestination, routeAlternate, waypointsKey]);

  // REA corridor overlay
  const reaKey = reaSegments ? reaSegments.map((s) => `${s.nome}:${s.trecho}`).join(';') : '';

  useEffect(() => {
    if (!mapRef.current || Platform.OS !== 'web') return;
    const L = require('leaflet') as any;
    const map = mapRef.current;

    if (reaLayerRef.current) {
      map.removeLayer(reaLayerRef.current);
      reaLayerRef.current = null;
    }

    if (!reaSegments || reaSegments.length === 0) return;

    const group = L.layerGroup().addTo(map);

    for (const seg of reaSegments) {
      const isMandatory = seg.tipo === 'Obrig';
      const color = isMandatory ? '#dc2626' : '#2563eb';
      const fillColor = isMandatory ? '#fca5a5' : '#93c5fd';

      // Convert GeoJSON coordinates to Leaflet-compatible [lat, lng] arrays
      const coordSets = seg.geometry.type === 'MultiPolygon'
        ? (seg.geometry.coordinates as number[][][][]).map((poly) => poly[0]!)
        : [seg.geometry.coordinates[0] as number[][]];

      for (const ring of coordSets) {
        const latlngs = ring.map((c: number[]) => [c[1], c[0]]);
        const polygon = L.polygon(latlngs, {
          color,
          weight: 1.5,
          fillColor,
          fillOpacity: 0.2,
          dashArray: isMandatory ? undefined : '5,5',
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reaKey]);

  const fetchAndRender = useCallback(async (map: any, L: any) => {
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
        if (zoom >= 9) return true;
        if (zoom >= 7) return a.type !== 'heliport' && a.type !== 'closed';
        if (zoom >= 5) return a.type === 'large_airport' || a.type === 'medium_airport';
        return a.type === 'large_airport';
      });

      // Add new markers
      for (const airport of filtered) {
        const color = airport.flightCategory
          ? (CATEGORY_COLORS[airport.flightCategory] ?? DEFAULT_DOT_COLOR)
          : DEFAULT_DOT_COLOR;

        const icon = L.divIcon({
          className: '',
          html: `<div style="background:${color};color:#fff;font-size:10px;font-weight:700;padding:2px 5px;border-radius:3px;white-space:nowrap;cursor:pointer;font-family:system-ui,sans-serif;line-height:1;letter-spacing:0.3px;box-shadow:0 1px 2px rgba(0,0,0,0.3);display:inline-block">${escapeHtml(airport.icao)}</div>`,
          iconSize: [0, 0],
          iconAnchor: [0, 8],
        });

        const marker = L.marker([airport.latitude, airport.longitude], { icon }).addTo(map);

        marker.on('click', () => {
          const catHtml = airport.flightCategory
            ? `<div style="font-size:11px;font-weight:600;color:${color};margin-bottom:6px">${airport.flightCategory}</div>`
            : '';

          const popupHtml = `
            <div style="min-width:190px;font-family:system-ui,sans-serif">
              <div style="font-weight:700;font-size:14px;color:#1a1d26;margin-bottom:2px">${escapeHtml(airport.icao)}</div>
              <div style="font-size:12px;color:#6b7280;margin-bottom:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(airport.name)}</div>
              ${catHtml}
              <div style="display:flex;gap:4px">
                <button data-role="origin" style="flex:1;padding:5px 4px;background:#2563eb;color:#fff;border:none;border-radius:4px;font-size:10px;font-weight:600;cursor:pointer">
                  ${escapeHtml(tRef.current('vfr.origin'))}
                </button>
                <button data-role="destination" style="flex:1;padding:5px 4px;background:#2563eb;color:#fff;border:none;border-radius:4px;font-size:10px;font-weight:600;cursor:pointer">
                  ${escapeHtml(tRef.current('vfr.destination'))}
                </button>
                <button data-role="alternate" style="flex:1;padding:5px 4px;background:#2563eb;color:#fff;border:none;border-radius:4px;font-size:10px;font-weight:600;cursor:pointer">
                  ${escapeHtml(tRef.current('vfr.alternate'))}
                </button>
              </div>
            </div>
          `;

          const popup = L.popup().setLatLng([airport.latitude, airport.longitude]).setContent(popupHtml).openOn(map);

          const popupEl = popup.getElement();
          if (popupEl) {
            popupEl.querySelectorAll('button[data-role]').forEach((btn: any) => {
              btn.addEventListener('click', (e: any) => {
                const role = e.currentTarget.getAttribute('data-role');
                const aerodrome: Aerodrome = {
                  icao: airport.icao, iata: airport.iata, name: airport.name,
                  city: airport.city, country: airport.country,
                  latitude: airport.latitude, longitude: airport.longitude,
                  elevation: airport.elevation, type: airport.type,
                };
                if (role === 'origin') onSelectOriginRef.current(aerodrome);
                else if (role === 'destination') onSelectDestRef.current(aerodrome);
                else if (role === 'alternate') onSelectAltRef.current(aerodrome);
                map.closePopup();
              });
            });
          }
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
            onPress={fitToRoute}
            style={{
              backgroundColor: 'rgba(255,255,255,0.92)', borderRadius: 4,
              borderWidth: 1, borderColor: '#dfe2e8',
              width: 32, height: 32, alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Text style={{ fontSize: 13, color: '#374151', fontWeight: '700' }}>{"\u21E4"}</Text>
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

// --------------- Satellite image URL ---------------

function buildSatelliteUrl(lat: number, lng: number, spanDeg: number, w: number, h: number): string {
  const aspect = h / w;
  return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export?bbox=${lng - spanDeg},${lat - spanDeg * aspect},${lng + spanDeg},${lat + spanDeg * aspect}&bboxSR=4326&size=${w},${h}&imageSR=4326&format=png&f=image`;
}

