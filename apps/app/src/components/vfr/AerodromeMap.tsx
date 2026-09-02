import { VfrLayerType } from '@fs-suite/types';
import type L from 'leaflet';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable, Text, View } from 'react-native';

import { API_URL, apiClient } from '../../services/api.client';

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

interface FlightCategoryData {
  icao: string;
  flightCategory: string | null;
  derived: boolean;
  referenceStation?: string;
  referenceDistanceNm?: number;
}

interface MapAerodrome extends Aerodrome {
  flightCategory?: string | null;
  derived?: boolean;
  referenceStation?: string;
  referenceDistanceNm?: number;
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
  onAddWaypoint?: (wp: RouteWaypoint, altFt?: number) => void;
  onRemoveWaypoint?: (index: number) => void;
  onUpdateWaypoint?: (index: number, wp: RouteWaypoint) => void;
  /** Sets the altitude that takes effect AT this waypoint (null = remove transition). */
  onSetAltitudeAtWaypoint?: (waypointName: string, altFt: number | null) => void;
  /** Alternate-leg (destination → alternate) intermediate waypoints. Rendered
   *  with the same waypoint+polyline pattern as the main route, but separate
   *  state so the two legs can be edited independently. */
  alternateRouteWaypoints?: RouteWaypoint[];
  onRemoveAlternateWaypoint?: (index: number) => void;
  onUpdateAlternateWaypoint?: (index: number, wp: RouteWaypoint) => void;
  /** Cruise altitude (feet) used as default when popups offer to set a waypoint altitude. */
  defaultCruiseAltFt?: number | null;
  /** Altitude at each existing route waypoint (matches routeWaypoints order). */
  waypointAltitudesFt?: (number | null | undefined)[];
  reaSegments?: ReaCorridorSegment[];
  selectedReaCorridorName?: string | null;
  flightRules?: 'VFR' | 'IFR' | 'VFR_IFR' | 'IFR_VFR';
  tocTodPositions?: TocTodPosition[];
  hazardSegments?: { fromIdx: number; toIdx: number; hazardType: string; severity: string }[];
  aerodromeOverlays?: AerodromeOverlay[];
  onCloseAerodromeOverlay?: (id: string) => void;
}

export interface AerodromeOverlay {
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
  approximate?: boolean;
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
const DERIVED_BG_COLORS: Record<string, string> = {
  VFR: 'rgba(20,83,45,0.35)',
  MVFR: 'rgba(30,58,95,0.35)',
  IFR: 'rgba(127,29,29,0.35)',
  LIFR: 'rgba(107,33,168,0.35)',
};
const DERIVED_BORDER_COLORS: Record<string, string> = {
  VFR: 'rgba(22,163,74,0.6)',
  MVFR: 'rgba(37,99,235,0.6)',
  IFR: 'rgba(220,38,38,0.6)',
  LIFR: 'rgba(217,70,239,0.6)',
};
const DEFAULT_DOT_COLOR = '#94a3b8';
const DEFAULT_BADGE_BG = 'rgba(55,65,81,0.8)';
const MAX_METAR_FETCH = 50;
const SATELLITE_LEGEND = [
  { color: '#c8c8c8', i18n: 'vfr.satWarmSurface' },
  { color: '#808080', i18n: 'vfr.satCoolSurface' },
  { color: '#00d4d4', i18n: 'vfr.satLowCloud' },
  { color: '#0055cc', i18n: 'vfr.satMidCloud' },
  { color: '#000088', i18n: 'vfr.satUpperCloud' },
  { color: '#00cc00', i18n: 'vfr.satHighCloud' },
  { color: '#aaff00', i18n: 'vfr.satVeryHigh' },
  { color: '#ffff00', i18n: 'vfr.satConvective' },
  { color: '#ff6600', i18n: 'vfr.satDeepConvective' },
] as const;

const PRECIP_LEGEND = [
  { color: '#78c8ff', i18n: 'vfr.radarDrizzle' },
  { color: '#1ea0ff', i18n: 'vfr.radarLight' },
  { color: '#00d250', i18n: 'vfr.radarModerate' },
  { color: '#fff000', i18n: 'vfr.radarHeavy' },
  { color: '#ff2800', i18n: 'vfr.radarVeryHeavy' },
] as const;

const DEFAULT_CENTER: [number, number] = [-15.78, -47.93];
const DEFAULT_ZOOM = 5;
const TILE_LAYERS = {
  map: {
    // Was Carto Voyager. Carto now stamps "API KEY REQUIRED" across every
    // unauthenticated basemap tile (both 1x and @2x, voyager and light_all),
    // so it is unusable without a key. Esri World_Street_Map is key-free and
    // is already the host of the satellite layer below.
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
    attr: '&copy; Esri, HERE, Garmin, USGS, NGA',
    i18nKey: 'vfr.layerMap',
  },
  satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attr: '&copy; Esri, Maxar, Earthstar Geographics',
    i18nKey: 'vfr.layerSatelliteBase',
  },
  topo: {
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    attr: '&copy; <a href="https://opentopomap.org">OpenTopoMap</a> &copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>',
    i18nKey: 'vfr.layerTopo',
  },
} as const;
type LayerKey = keyof typeof TILE_LAYERS;

// OpenAIP airspace tiles need a (public, frontend) API key. It is optional:
// when absent the airspace overlay is simply unavailable and the rest of the
// VFR map keeps working. Configure via EXPO_PUBLIC_OPENAIP_API_KEY.
const OPENAIP_API_KEY = process.env['EXPO_PUBLIC_OPENAIP_API_KEY'] ?? '';
const OPENAIP_TILE_URL = OPENAIP_API_KEY
  ? `https://api.tiles.openaip.net/api/data/openaip/{z}/{x}/{y}.png?apiKey=${OPENAIP_API_KEY}`
  : null;
const OPENAIP_AVAILABLE = OPENAIP_TILE_URL !== null;

const DECEA_WMS_BASE = 'https://geoaisweb.decea.mil.br/geoserver/ICA/wms';
type ChartOverlayKey = 'rea' | 'wac' | 'enrcL' | 'enrcH' | 'airspaceDecea';
// Generic VFR-layer metadata (worldwide model). Annotation only — rendering and
// toggles are unchanged; it tags which overlays are VFR specializations and lets
// future country grouping read country/layerType. See docs/vfr-layer-model.md.
type VfrLayerMeta = {
  country: string;
  provider: 'DECEA_GEOAISWEB';
  isOfficial: boolean;
  layerType?: VfrLayerType;
};
const DECEA_CHART_OVERLAYS: Record<
  ChartOverlayKey,
  { layers: string; i18nKey: string; minZoom: number; maxZoom: number; opacity: number; meta: VfrLayerMeta }
> = {
  rea: { layers: 'ICA:CCV_REA_CY_CUIABA,ICA:CCV_REA_PI-PARINTINS,ICA:CCV_REA_WA_TABATINGA,ICA:CCV_REA_WB_BELEM,ICA:CCV_REA_WF_RECIFE,ICA:CCV_REA_WG_CAMPO_GRANDE,ICA:CCV_REA_WH_BELO_HORIZONTE,ICA:CCV_REA_WJ1_RIO_DE_JANEIRO,ICA:CCV_REA_WK_PORTO_SEGURO,ICA:CCV_REA_WN2_MANAUS,ICA:CCV_REA_WP_PORTO_ALEGRE,ICA:CCV_REA_WR_BRASILIA,ICA:CCV_REA_WS_SAO_LUIS,ICA:CCV_REA_WX_SANTAREM,ICA:CCV_REA_WZ_FORTALEZA,ICA:CCV_REA_XF_FLORIANOPOLIS,ICA:CCV_REA_XK_MACAPA,ICA:CCV_REA_XN-ANAPOLIS,ICA:CCV_REA_XP1_SAO_PAULO,ICA:CCV_REA_XP2_SAO_PAULO,ICA:CCV_REA_XR_VITORIA,ICA:CCV_REA_XS_SALVADOR,ICA:CCV_REA_XT_NATAL', i18nKey: 'vfr.layerRea', minZoom: 7, maxZoom: 14, opacity: 0.75, meta: { country: 'BR', provider: 'DECEA_GEOAISWEB', isOfficial: true, layerType: VfrLayerType.BR_REA } },
  wac: { layers: 'ICA:WAC_2825_CABO_ORANGE,ICA:WAC_2826_MONTE_RORAIMA,ICA:WAC_2827_SERRA_PACARAIMA,ICA:WAC_2892_PICO_DA_NEBLINA,ICA:WAC_2893_BOA_VISTA,ICA:WAC_2894_TUMUCUMAQUE,ICA:WAC_2895_MACAPA,ICA:WAC_2944_FORTALEZA,ICA:WAC_2945_SAO_LUIS,ICA:WAC_2946_BELEM,ICA:WAC_2947_SANTAREM,ICA:WAC_2948_MANAUS,ICA:WAC_2949_SAO_GABRIEL_DA_CACHOEIRA,ICA:WAC_3012_CRUZEIRO_DO_SUL,ICA:WAC_3013_TABATINGA,ICA:WAC_3014_HUMAITA,ICA:WAC_3015_ITAITUBA,ICA:WAC_3016_IMPERATRIZ,ICA:WAC_3017_TERESINA,ICA:WAC_3018_NATAL,ICA:WAC_3019_FERNANDO_DE_NORONHA,ICA:WAC_3066_RECIFE,ICA:WAC_3067_PETROLINA,ICA:WAC_3068_PORTO_NACIONAL,ICA:WAC_3069_CACHIMBO,ICA:WAC_3070_JI_PARANA,ICA:WAC_3071_PORTO_VELHO,ICA:WAC_3072_TARAUACA,ICA:WAC_3137_PRINCIPE_DA_BEIRA,ICA:WAC_3138_CUIABA,ICA:WAC_3139_ARAGARCAS,ICA:WAC_3140_BRASILIA,ICA:WAC_3141_SALVADOR,ICA:WAC_3189_BELO_HORIZONTE,ICA:WAC_3190_GOIANIA,ICA:WAC_3191_RONDONOPOLIS,ICA:WAC_3192_CORUMBA,ICA:WAC_3260_BELA_VISTA,ICA:WAC_3261_CAMPO_GRANDE,ICA:WAC_3262_SAO_PAULO,ICA:WAC_3263_RIO_DE_JANEIRO,ICA:WAC_3313_CURITIBA,ICA:WAC_3314_FOZ_DO_IGUACU,ICA:WAC_3383_URUGUAIANA,ICA:WAC_3384_PORTO_ALEGRE,ICA:WAC_3434_RIO_DA_PRATA', i18nKey: 'vfr.layerWac', minZoom: 6, maxZoom: 12, opacity: 0.6, meta: { country: 'BR', provider: 'DECEA_GEOAISWEB', isOfficial: true, layerType: VfrLayerType.BR_WAC } },
  enrcL: { layers: 'ICA:ENRC_L1,ICA:ENRC_L2,ICA:ENRC_L3,ICA:ENRC_L4,ICA:ENRC_L5,ICA:ENRC_L6,ICA:ENRC_L7,ICA:ENRC_L8,ICA:ENRC_L9', i18nKey: 'vfr.layerEnrcLow', minZoom: 5, maxZoom: 12, opacity: 0.65, meta: { country: 'BR', provider: 'DECEA_GEOAISWEB', isOfficial: true } },
  enrcH: { layers: 'ICA:ENRC_H1,ICA:ENRC_H2,ICA:ENRC_H3,ICA:ENRC_H4,ICA:ENRC_H5,ICA:ENRC_H6,ICA:ENRC_H7,ICA:ENRC_H8,ICA:ENRC_H9', i18nKey: 'vfr.layerEnrcHigh', minZoom: 5, maxZoom: 12, opacity: 0.65, meta: { country: 'BR', provider: 'DECEA_GEOAISWEB', isOfficial: true } },
  airspaceDecea: { layers: 'ICA:SETOR_FIR,ICA:TMA,ICA:CTR,ICA:ATZ', i18nKey: 'vfr.layerAirspaceDecea', minZoom: 5, maxZoom: 14, opacity: 0.5, meta: { country: 'BR', provider: 'DECEA_GEOAISWEB', isOfficial: true } },
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
  onSetAltitudeAtWaypoint, defaultCruiseAltFt, waypointAltitudesFt,
  alternateRouteWaypoints, onRemoveAlternateWaypoint, onUpdateAlternateWaypoint,
  reaSegments, selectedReaCorridorName, flightRules, tocTodPositions, hazardSegments,
  aerodromeOverlays, onCloseAerodromeOverlay,
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
  const sigmetLayerRef = useRef<L.GeoJSON | null>(null);
  const radarLayerRef = useRef<L.TileLayer | null>(null);
  const satelliteLayerRef = useRef<L.TileLayer | null>(null);
  // Multiple chart overlays can be plotted at once (e.g. origin + destination +
  // alternate VACs). One Leaflet layer per overlay id; a single global opacity.
  const aerodromeOverlayLayersRef = useRef<Map<string, L.ImageOverlay>>(new Map());
  const [aerodromeOverlayOpacity, setAerodromeOverlayOpacity] = useState<number>(0.7);
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
  const [showSigmets, setShowSigmets] = useState(false);
  const [showRadar, setShowRadar] = useState(false);
  const [showSatellite, setShowSatellite] = useState(false);

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
  const onSetAltRef = useRef(onSetAltitudeAtWaypoint);
  onSetAltRef.current = onSetAltitudeAtWaypoint;
  const defaultCruiseRef = useRef(defaultCruiseAltFt);
  defaultCruiseRef.current = defaultCruiseAltFt;
  const waypointAltsRef = useRef(waypointAltitudesFt);
  waypointAltsRef.current = waypointAltitudesFt;
  // Alternate route callback refs
  const onRemoveAltWpRef = useRef(onRemoveAlternateWaypoint);
  onRemoveAltWpRef.current = onRemoveAlternateWaypoint;
  const onUpdateAltWpRef = useRef(onUpdateAlternateWaypoint);
  onUpdateAltWpRef.current = onUpdateAlternateWaypoint;
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
      const cruiseAlt = defaultCruiseRef.current ?? null;
      const altPlaceholder = cruiseAlt != null ? String(cruiseAlt) : tRef.current('vfr.altitudePlaceholderCruise');

      const popupHtml = `
        <div style="font-family:system-ui,sans-serif;min-width:200px">
          <div style="font-weight:600;font-size:11px;margin-bottom:6px;color:#6b7280">
            ${lat.toFixed(4)}, ${lng.toFixed(4)}
          </div>
          <div style="margin-bottom:6px">
            <label style="font-size:10px;color:#6b7280;display:block;margin-bottom:2px">${escapeHtml(tRef.current('vfr.waypointName'))}</label>
            <input id="wp-name-input" type="text" value="${defaultName}"
              style="width:100%;padding:4px 6px;border:1px solid #d1d5db;border-radius:4px;font-size:12px;box-sizing:border-box;font-weight:600" />
          </div>
          <div style="margin-bottom:8px">
            <label style="font-size:10px;color:#6b7280;display:block;margin-bottom:2px">${escapeHtml(tRef.current('vfr.altitudeFt'))}</label>
            <input id="wp-alt-input" type="number" inputmode="numeric" placeholder="${escapeHtml(altPlaceholder)}"
              style="width:100%;padding:4px 6px;border:1px solid #d1d5db;border-radius:4px;font-size:12px;box-sizing:border-box" />
          </div>
          <button data-action="add-waypoint"
            style="width:100%;padding:6px 4px;background:${ROUTE_COLOR};color:#fff;border:none;border-radius:4px;font-size:11px;font-weight:600;cursor:pointer">
            + ${escapeHtml(tRef.current('vfr.addWaypoint'))}
          </button>
        </div>
      `;

      const popup = Leaf.popup({ closeButton: true }).setLatLng(e.latlng).setContent(popupHtml).openOn(map);
      const popupEl = popup.getElement() as unknown as DomElement | undefined;
      if (popupEl) {
        const readFields = (): { name: string; altFt: number | undefined } => {
          const nameInput = popupEl.querySelector?.('#wp-name-input');
          const altInput = popupEl.querySelector?.('#wp-alt-input');
          const name = (nameInput?.value as string | undefined)?.trim() || defaultName;
          const altRaw = (altInput?.value as string | undefined)?.trim();
          const altFt = altRaw ? parseInt(altRaw, 10) : NaN;
          return { name, altFt: Number.isFinite(altFt) && altFt > 0 ? altFt : undefined };
        };
        const btnMain = popupEl.querySelector?.('button[data-action="add-waypoint"]');
        btnMain?.addEventListener('click', () => {
          const { name, altFt } = readFields();
          onAddWpRef.current?.({ lat, lng, name }, altFt);
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
    if (!mapInitialized || !mapRef.current || Platform.OS !== 'web') return;
    const Leaf = require('leaflet') as LeafletModule;
    const map = mapRef.current;
    const layer = TILE_LAYERS[activeLayer];
    if (tileLayerRef.current) map.removeLayer(tileLayerRef.current);
    tileLayerRef.current = Leaf.tileLayer(layer.url, { attribution: layer.attr, maxZoom: 18, crossOrigin: 'anonymous' }).addTo(map);
  }, [activeLayer, mapInitialized]);

  // Toggle OpenAIP airspace overlay
  useEffect(() => {
    if (!mapInitialized || !mapRef.current || Platform.OS !== 'web') return;
    const Leaf = require('leaflet') as LeafletModule;
    const map = mapRef.current;

    if (showAirspace && OPENAIP_TILE_URL && !openAipLayerRef.current) {
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
  }, [showAirspace, mapInitialized]);

  // DECEA WMS chart overlay (mutually exclusive — only one active at a time)
  useEffect(() => {
    if (!mapInitialized || !mapRef.current || Platform.OS !== 'web') return;
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
  }, [activeChart, mapInitialized]);

  // SIGMET / AIRMET GeoJSON overlay
  useEffect(() => {
    if (!mapInitialized || !mapRef.current || Platform.OS !== 'web') return;
    const Leaf = require('leaflet') as LeafletModule;
    const map = mapRef.current;

    if (!showSigmets) {
      if (sigmetLayerRef.current) {
        map.removeLayer(sigmetLayerRef.current);
        sigmetLayerRef.current = null;
      }
      return;
    }

    const HAZARD_STYLES: Record<string, { fill: string; border: string }> = {
      TS: { fill: '#ef4444', border: '#dc2626' },
      TURB: { fill: '#f97316', border: '#c2410c' },
      ICE: { fill: '#06b6d4', border: '#0891b2' },
      IFR: { fill: '#3b82f6', border: '#1d4ed8' },
      MTN_OBSC: { fill: '#6b7280', border: '#4b5563' },
      OTHER: { fill: '#6b7280', border: '#4b5563' },
    };

    const HAZARD_I18N: Record<string, string> = {
      TS: 'vfr.sigmetTs',
      TURB: 'vfr.sigmetTurb',
      ICE: 'vfr.sigmetIce',
      IFR: 'vfr.sigmetIfr',
      MTN_OBSC: 'vfr.sigmetMtnObsc',
      OTHER: 'vfr.sigmetOther',
    };

    const QUALIFIER_I18N: Record<string, string> = {
      EMBD: 'vfr.sigmetQualEmbd',
      OBSC: 'vfr.sigmetQualObsc',
      FRQ: 'vfr.sigmetQualFrq',
      SQL: 'vfr.sigmetQualSql',
      ISOL: 'vfr.sigmetQualIsol',
      OCNL: 'vfr.sigmetQualOccnl',
      SEV: 'vfr.sigmetQualSevere',
      MOD: 'vfr.sigmetQualModerate',
    };

    let cancelled = false;
    let interval: ReturnType<typeof setInterval>;

    const loadSigmets = async () => {
      try {
        const res = await apiClient.get<{
          type: string;
          features: Array<{
            type: string;
            geometry: object;
            properties: {
              hazardType?: string;
              rawText?: string;
              firId?: string | null;
              sigmetType?: string;
              validFrom?: string;
              validTo?: string;
            };
          }>;
        }>('/weather/sigmets');
        if (cancelled) return;

        if (sigmetLayerRef.current) {
          map.removeLayer(sigmetLayerRef.current);
        }

        const geojson: GeoJSON.FeatureCollection = {
          type: 'FeatureCollection',
          features: (res.features ?? []).map((f) => ({
            type: 'Feature' as const,
            geometry: f.geometry as GeoJSON.Geometry,
            properties: f.properties,
          })),
        };

        sigmetLayerRef.current = Leaf.geoJSON(geojson, {
          style: (feature) => {
            const hazard: string = feature?.properties?.hazardType ?? 'OTHER';
            const s = HAZARD_STYLES[hazard] ?? HAZARD_STYLES.OTHER!;
            const isFcst = feature?.properties?.status === 'FCST';
            return {
              color: s.border, weight: 2, fillColor: s.fill,
              fillOpacity: isFcst ? 0.2 : 0.4,
              dashArray: isFcst ? '8 4' : undefined,
            };
          },
          onEachFeature: (feature, layer) => {
            const p = feature.properties ?? {};
            const t_ = tRef.current;
            const hazardLabel = t_(HAZARD_I18N[p.hazardType as string] ?? 'vfr.sigmetOther');
            const qualKey = QUALIFIER_I18N[(p.qualifier as string ?? '').toUpperCase()];
            const qualLabel = qualKey ? t_(qualKey) : (p.qualifier as string) ?? '';
            const validFrom = p.validFrom ? new Date(p.validFrom as string).toUTCString().slice(0, -4) : '';
            const validTo = p.validTo ? new Date(p.validTo as string).toUTCString().slice(0, -4) : '';
            const topFt = p.topFt as number | null;
            const movDir = p.movementDir as number | null;
            const movSpd = p.movementSpd as number | null;
            const status = p.status as string | null;

            const statusBadge = status === 'OBS'
              ? `<span style="background:#dc2626;color:#fff;font-size:9px;font-weight:700;padding:1px 5px;border-radius:3px">${t_('vfr.sigmetObs')}</span>`
              : status === 'FCST'
                ? `<span style="background:#d97706;color:#fff;font-size:9px;font-weight:700;padding:1px 5px;border-radius:3px">${t_('vfr.sigmetFcst')}</span>`
                : '';
            const statusHint = status === 'OBS'
              ? `<div style="font-size:9px;color:#6b7280;font-style:italic;margin-bottom:4px">${t_('vfr.sigmetObsHint')}</div>`
              : status === 'FCST'
                ? `<div style="font-size:9px;color:#6b7280;font-style:italic;margin-bottom:4px">${t_('vfr.sigmetFcstHint')}</div>`
                : '';

            const details: string[] = [];
            if (qualLabel) details.push(escapeHtml(qualLabel));
            if (topFt != null) details.push(`${t_('vfr.sigmetTop')} FL${Math.round(topFt / 100)}`);

            let movementLine = '';
            if (movDir != null && movSpd != null) {
              movementLine = `${t_('vfr.sigmetMoving')} ${movDir}° / ${movSpd}kt`;
            } else if (status != null) {
              movementLine = t_('vfr.sigmetStationary');
            }

            layer.bindPopup(
              `<div style="font-family:system-ui,sans-serif;max-width:360px">` +
                `<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">` +
                  `<span style="font-weight:700;font-size:13px;color:#1e293b">${(p.sigmetType as string) ?? 'SIGMET'} — ${escapeHtml(hazardLabel)}</span>` +
                  statusBadge +
                `</div>` +
                statusHint +
                (p.firId ? `<div style="font-size:10px;color:#6b7280;margin-bottom:4px">FIR ${escapeHtml(p.firId as string)}</div>` : '') +
                (details.length > 0 ? `<div style="font-size:11px;color:#334155;margin-bottom:4px">${details.join(' · ')}</div>` : '') +
                (movementLine ? `<div style="font-size:11px;color:#334155;margin-bottom:4px">${escapeHtml(movementLine)}</div>` : '') +
                (validFrom || validTo ? `<div style="font-size:10px;color:#6b7280;margin-bottom:6px">${t_('vfr.sigmetValid')}: ${validFrom} → ${validTo}</div>` : '') +
                `<details style="margin-top:2px"><summary style="font-size:10px;color:#6b7280;cursor:pointer">Raw SIGMET</summary>` +
                `<div style="font-family:monospace;font-size:9px;color:#475569;margin-top:4px;word-break:break-all;line-height:1.4;white-space:pre-wrap;background:#f1f5f9;padding:6px;border-radius:4px">${escapeHtml((p.rawText as string) ?? '')}</div>` +
                `</details>` +
              `</div>`,
              { maxWidth: 400 },
            );
          },
        }).addTo(map);
      } catch (err) {
        console.warn('[SIGMET] Failed to load:', err);
      }
    };

    void loadSigmets();
    interval = setInterval(() => void loadSigmets(), 600_000);

    return () => {
      cancelled = true;
      clearInterval(interval);
      if (sigmetLayerRef.current) {
        map.removeLayer(sigmetLayerRef.current);
        sigmetLayerRef.current = null;
      }
    };
  }, [showSigmets, mapInitialized]);

  // OpenWeatherMap precipitation overlay (proxied via API to keep key server-side)
  useEffect(() => {
    if (!mapInitialized || !mapRef.current || Platform.OS !== 'web') return;
    const Leaf = require('leaflet') as LeafletModule;
    const map = mapRef.current;

    if (!showRadar) {
      if (radarLayerRef.current) { map.removeLayer(radarLayerRef.current); radarLayerRef.current = null; }
      return;
    }

    radarLayerRef.current = Leaf.tileLayer(
      `${API_URL}/v1/weather/tiles/precipitation/{z}/{x}/{y}.png`,
      { opacity: 0.8, zIndex: 400, maxNativeZoom: 6, maxZoom: 18 },
    ).addTo(map);

    const refreshInterval = setInterval(() => {
      if (radarLayerRef.current) radarLayerRef.current.redraw();
    }, 600_000);

    return () => {
      clearInterval(refreshInterval);
      if (radarLayerRef.current) { map.removeLayer(radarLayerRef.current); radarLayerRef.current = null; }
    };
  }, [showRadar, mapInitialized]);

  // GOES-16 satellite infrared overlay (NASA GIBS)
  useEffect(() => {
    if (!mapInitialized || !mapRef.current || Platform.OS !== 'web') return;
    const Leaf = require('leaflet') as LeafletModule;
    const map = mapRef.current;

    if (!showSatellite) {
      if (satelliteLayerRef.current) { map.removeLayer(satelliteLayerRef.current); satelliteLayerRef.current = null; }
      return;
    }

    const gibsUrl = (date: string) =>
      `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/GOES-East_ABI_Band13_Clean_Infrared/default/${date}/GoogleMapsCompatible_Level6/{z}/{y}/{x}.png`;

    const today = new Date().toISOString().slice(0, 10);
    satelliteLayerRef.current = Leaf.tileLayer(gibsUrl(today), {
      opacity: 0.55, zIndex: 350, maxNativeZoom: 6, maxZoom: 18, attribution: 'NASA GIBS',
    }).addTo(map);

    const refreshInterval = setInterval(() => {
      if (satelliteLayerRef.current && mapRef.current) {
        mapRef.current.removeLayer(satelliteLayerRef.current);
        const d = new Date().toISOString().slice(0, 10);
        satelliteLayerRef.current = Leaf.tileLayer(gibsUrl(d), {
          opacity: 0.55, zIndex: 350, maxNativeZoom: 6, maxZoom: 18, attribution: 'NASA GIBS',
        }).addTo(mapRef.current);
      }
    }, 600_000);

    return () => {
      clearInterval(refreshInterval);
      if (satelliteLayerRef.current) { map.removeLayer(satelliteLayerRef.current); satelliteLayerRef.current = null; }
    };
  }, [showSatellite, mapInitialized]);

  // Aerodrome chart overlays (VAC) — one L.imageOverlay per active chart.
  // Diffs the desired set against the live layers: add new, remove gone.
  useEffect(() => {
    if (!mapInitialized || !mapRef.current || Platform.OS !== 'web') return;
    const Leaf = require('leaflet') as LeafletModule;
    const map = mapRef.current;
    const layers = aerodromeOverlayLayersRef.current;
    const overlays = aerodromeOverlays ?? [];
    const wanted = new Set(overlays.map((o) => o.id));

    // Remove layers whose overlay is no longer active.
    for (const [id, layer] of layers) {
      if (!wanted.has(id)) {
        map.removeLayer(layer);
        layers.delete(id);
      }
    }

    // Add layers for newly-activated overlays.
    for (const o of overlays) {
      if (layers.has(o.id)) continue;
      const latLngBounds = Leaf.latLngBounds(
        [o.bounds.south, o.bounds.west],
        [o.bounds.north, o.bounds.east],
      );
      const imageUrl = `${API_URL}/v1/aerodromes/chart-overlays/${o.id}/image`;
      const layer = Leaf.imageOverlay(imageUrl, latLngBounds, {
        opacity: aerodromeOverlayOpacity,
        interactive: false,
        crossOrigin: 'anonymous',
      }).addTo(map);
      // Place below markers but above base tiles and weather layers
      const el = layer.getElement() as unknown as DomElement | null;
      if (el) {
        el.style.zIndex = '500';
        if (o.rotationDeg && o.rotationDeg !== 0) {
          el.style.transformOrigin = 'center center';
          const existing = el.style.transform ?? '';
          el.style.transform = `${existing} rotate(${o.rotationDeg}deg)`;
        }
      }
      layers.set(o.id, layer);
    }
    return undefined;
  }, [aerodromeOverlays, mapInitialized]);

  // Live-update opacity on slider drag (global — applies to every overlay).
  useEffect(() => {
    for (const layer of aerodromeOverlayLayersRef.current.values()) {
      layer.setOpacity(aerodromeOverlayOpacity);
    }
  }, [aerodromeOverlayOpacity]);

  const fitToAerodromeOverlay = useCallback((id: string) => {
    const o = (aerodromeOverlays ?? []).find((x) => x.id === id);
    if (!mapRef.current || !o) return;
    const Leaf = require('leaflet') as LeafletModule;
    const b = Leaf.latLngBounds([o.bounds.south, o.bounds.west], [o.bounds.north, o.bounds.east]);
    mapRef.current.fitBounds(b, { padding: [20, 20] });
  }, [aerodromeOverlays]);

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
  }, [activeChart, mapInitialized]);

  // Route rendering — redraws when waypoints / origin / destination change
  // Serialize waypoints for stable dependency (array reference may not change on re-render)
  const waypointsKey = routeWaypoints ? routeWaypoints.map((w) => `${w.lat},${w.lng}`).join(';') : '';
  const altWaypointsKey = alternateRouteWaypoints ? alternateRouteWaypoints.map((w) => `${w.lat},${w.lng}`).join(';') : '';

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

    // Hazard overlay — red segments where SIGMETs intersect the route
    if (hazardSegments && hazardSegments.length > 0) {
      for (const seg of hazardSegments) {
        if (seg.fromIdx < fullRoute.length && seg.toIdx < fullRoute.length) {
          const a = fullRoute[seg.fromIdx]!;
          const b = fullRoute[seg.toIdx]!;
          const color = seg.severity === 'blocking' ? '#dc2626' : '#f59e0b';
          Leaf.polyline([[a.lat, a.lng], [b.lat, b.lng]] as L.LatLngTuple[], {
            color, weight: 7, opacity: 0.9, lineCap: 'round', lineJoin: 'round', dashArray: '12 6',
          }).addTo(group);
        }
      }
    }

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
          const currentAlt = waypointAltsRef.current?.[wpIdx];
          const altValue = currentAlt != null ? String(currentAlt) : '';
          const cruiseAlt = defaultCruiseRef.current ?? null;
          const altPlaceholder = cruiseAlt != null ? String(cruiseAlt) : tRef.current('vfr.altitudePlaceholderCruise');
          const popup = Leaf.popup({ closeButton: true, minWidth: 220 }).setLatLng(pos).setContent(`
            <div style="font-family:system-ui,sans-serif;min-width:220px">
              <div style="font-size:10px;color:#6b7280;margin-bottom:8px">${pos.lat.toFixed(4)}, ${pos.lng.toFixed(4)}</div>
              <div style="margin-bottom:6px">
                <label style="font-size:10px;color:#6b7280;display:block;margin-bottom:2px">${escapeHtml(tRef.current('vfr.waypointName'))}</label>
                <input id="wp-edit-name" type="text" value="${escapeHtml(wp.name)}"
                  style="width:100%;padding:4px 6px;border:1px solid #d1d5db;border-radius:4px;font-size:12px;box-sizing:border-box;font-weight:600" />
              </div>
              <div style="margin-bottom:8px">
                <label style="font-size:10px;color:#6b7280;display:block;margin-bottom:2px">${escapeHtml(tRef.current('vfr.altitudeFt'))}</label>
                <input id="wp-edit-alt" type="number" inputmode="numeric" value="${altValue}" placeholder="${escapeHtml(altPlaceholder)}"
                  style="width:100%;padding:4px 6px;border:1px solid #d1d5db;border-radius:4px;font-size:12px;box-sizing:border-box" />
              </div>
              <div style="display:flex;gap:6px;margin-bottom:6px">
                <button data-action="save-wp"
                  style="flex:1;display:inline-flex;align-items:center;justify-content:center;gap:4px;padding:5px 4px;background:${ROUTE_COLOR};color:#fff;border:none;border-radius:4px;font-size:11px;font-weight:600;cursor:pointer">
                  ${escapeHtml(tRef.current('common.save'))}
                </button>
                <button data-action="sat-wp"
                  style="flex:0 0 36px;display:inline-flex;align-items:center;justify-content:center;padding:5px;background:#4f46e5;color:#fff;border:none;border-radius:4px;font-size:11px;font-weight:600;cursor:pointer"
                  title="Satélite">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>
                </button>
                <button data-action="remove-wp"
                  style="flex:0 0 36px;display:inline-flex;align-items:center;justify-content:center;padding:5px;background:#dc2626;color:#fff;border:none;border-radius:4px;font-size:11px;font-weight:600;cursor:pointer"
                  title="${escapeHtml(tRef.current('vfr.removeWaypoint'))}">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                </button>
              </div>
            </div>
          `).openOn(map);
          const popupEl = popup.getElement() as unknown as DomElement | undefined;
          if (popupEl) {
            popupEl.querySelector?.('button[data-action="save-wp"]')?.addEventListener('click', () => {
              const nameInput = popupEl.querySelector?.('#wp-edit-name');
              const altInput = popupEl.querySelector?.('#wp-edit-alt');
              const newName = (nameInput?.value as string | undefined)?.trim() || wp.name;
              const altRaw = (altInput?.value as string | undefined)?.trim();
              const curPos = marker.getLatLng();
              if (newName !== wp.name) {
                onUpdateWpRef.current?.(wpIdx, { lat: curPos.lat, lng: curPos.lng, name: newName });
              }
              if (altRaw === '') {
                onSetAltRef.current?.(newName, null);
              } else {
                const altFt = parseInt(altRaw ?? '', 10);
                if (Number.isFinite(altFt) && altFt > 0) {
                  onSetAltRef.current?.(newName, altFt);
                }
              }
              map.closePopup();
            });
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

    // Alternate route — full feature parity with the main leg: draggable
    // intermediate waypoints with live polyline update and an edit popup
    // (rename / satellite / remove). ICA 100-12 REA compliance applies here too.
    // Declared outside the block so the leg-label visibility pass below can see it.
    const altLegLabels: { from: L.LatLngTuple; to: L.LatLngTuple; marker: L.Marker }[] = [];
    if (routeDestination && routeAlternate) {
      const altPath: { lat: number; lng: number; name: string; isIntermediate: boolean }[] = [
        { ...routeDestination, isIntermediate: false },
      ];
      if (alternateRouteWaypoints && alternateRouteWaypoints.length > 0) {
        for (const wp of alternateRouteWaypoints) altPath.push({ ...wp, isIntermediate: true });
      }
      altPath.push({ ...routeAlternate, isIntermediate: false });

      const altLatlngs: L.LatLngTuple[] = altPath.map((p) => [p.lat, p.lng] as L.LatLngTuple);
      const altOutlinePoly = Leaf.polyline(altLatlngs, { color: ALT_ROUTE_OUTLINE, weight: 8, opacity: 0.6, lineCap: 'butt', lineJoin: 'round' }).addTo(group);
      const altMainPoly = Leaf.polyline(altLatlngs, { color: ALT_ROUTE_COLOR, weight: 5, opacity: 0.85, lineCap: 'butt', lineJoin: 'round' }).addTo(group);
      // Mutable copy for live drag updates (index 0 = destination).
      const altLive = altPath.map((p) => [p.lat, p.lng] as [number, number]);

      const altEmblemIcon = Leaf.divIcon({
        className: 'leg-label-tooltip',
        html: airportEmblem(ALT_ROUTE_COLOR, emblemSize),
        iconSize: [emblemSize, emblemSize] as L.PointTuple,
        iconAnchor: [emblemSize / 2, emblemSize / 2] as L.PointTuple,
      });
      Leaf.marker([routeAlternate.lat, routeAlternate.lng], { icon: altEmblemIcon, interactive: false, pane: 'routeLabels' }).addTo(group);

      // Per-leg pill labels (kept so drag can update them live + the visibility pass can read them).
      for (let i = 0; i < altPath.length - 1; i++) {
        const a = altPath[i]!;
        const b = altPath[i + 1]!;
        const { midLat, midLng, html } = buildLegPillHtml(a.lat, a.lng, b.lat, b.lng);
        const altLabelIcon = Leaf.divIcon({
          className: 'leg-label-tooltip route-leg-pill',
          html: html.replace(ROUTE_OUTLINE, ALT_ROUTE_OUTLINE),
          iconSize: [0, 0] as L.PointTuple,
          iconAnchor: [0, 0] as L.PointTuple,
        });
        const altM = Leaf.marker([midLat, midLng], { icon: altLabelIcon, interactive: false, pane: 'routeLabels' }).addTo(group);
        altLegLabels.push({ from: [a.lat, a.lng] as L.LatLngTuple, to: [b.lat, b.lng] as L.LatLngTuple, marker: altM });
      }
      const updateAltLegLabel = (legIdx: number) => {
        const lm = altLegLabels[legIdx]?.marker;
        const fromPos = altLive[legIdx];
        const toPos = altLive[legIdx + 1];
        if (!lm || !fromPos || !toPos) return;
        const { midLat, midLng, html } = buildLegPillHtml(fromPos[0], fromPos[1], toPos[0], toPos[1]);
        lm.setLatLng([midLat, midLng]);
        const el = lm.getElement() as unknown as DomElement | null;
        if (el) el.innerHTML = html.replace(ROUTE_OUTLINE, ALT_ROUTE_OUTLINE);
      };

      // Intermediate alt waypoint markers — draggable, name label + edit popup.
      if (alternateRouteWaypoints && alternateRouteWaypoints.length > 0) {
        alternateRouteWaypoints.forEach((wp, wpIdx) => {
          const li = wpIdx + 1; // index into altLive (destination at 0)

          const nameIcon = Leaf.divIcon({
            className: 'leg-label-tooltip',
            html: `<div style="transform:translate(-50%,-100%);margin-top:-8px"><div style="display:inline-flex;align-items:center;gap:4px;background:rgba(120,53,15,0.6);color:#fff;font-size:11px;font-weight:700;padding:3px 7px;border-radius:4px;white-space:nowrap;font-family:system-ui,sans-serif;line-height:1;letter-spacing:0.4px;border:1px solid rgba(255,255,255,0.12)"><span style="width:8px;height:8px;border-radius:4px;background:${ALT_ROUTE_COLOR};flex-shrink:0"></span>${escapeHtml(wp.name)}</div><div style="width:0;height:0;border-left:4px solid transparent;border-right:4px solid transparent;border-top:4px solid rgba(120,53,15,0.6);margin:0 auto"></div></div>`,
            iconSize: [0, 0] as L.PointTuple,
            iconAnchor: [0, 0] as L.PointTuple,
          });
          const nameMarker = Leaf.marker([wp.lat, wp.lng], { icon: nameIcon, interactive: false, pane: 'routeLabels' }).addTo(group);

          const wpIcon = Leaf.divIcon({
            className: 'leg-label-tooltip',
            html: `<svg width="14" height="14" viewBox="0 0 14 14"><circle cx="7" cy="7" r="5" fill="#fff" stroke="${ALT_ROUTE_COLOR}" stroke-width="2.5"/></svg>`,
            iconSize: [14, 14] as L.PointTuple,
            iconAnchor: [7, 7] as L.PointTuple,
          });
          const marker = Leaf.marker([wp.lat, wp.lng], { icon: wpIcon, pane: 'routeLabels', draggable: true }).addTo(group);
          const mEl = marker.getElement() as unknown as DomElement | null;
          if (mEl) mEl.style['cursor'] = 'move';

          marker.on('drag', () => {
            const pos = marker.getLatLng();
            altLive[li] = [pos.lat, pos.lng];
            altOutlinePoly.setLatLngs(altLive);
            altMainPoly.setLatLngs(altLive);
            nameMarker.setLatLng(pos);
            if (li > 0) updateAltLegLabel(li - 1);
            if (li < altLive.length - 1) updateAltLegLabel(li);
          });

          marker.on('dragend', () => {
            const pos = marker.getLatLng();
            onUpdateAltWpRef.current?.(wpIdx, { lat: pos.lat, lng: pos.lng, name: wp.name });
          });

          marker.on('contextmenu', (e: L.LeafletMouseEvent) => {
            Leaf.DomEvent.stopPropagation(e);
            const pos = marker.getLatLng();
            const popup = Leaf.popup({ closeButton: true, minWidth: 220 }).setLatLng(pos).setContent(`
              <div style="font-family:system-ui,sans-serif;min-width:220px">
                <div style="font-size:10px;color:#6b7280;margin-bottom:8px">${pos.lat.toFixed(4)}, ${pos.lng.toFixed(4)}</div>
                <div style="margin-bottom:8px">
                  <label style="font-size:10px;color:#6b7280;display:block;margin-bottom:2px">${escapeHtml(tRef.current('vfr.waypointName'))}</label>
                  <input id="alt-wp-name" type="text" value="${escapeHtml(wp.name)}"
                    style="width:100%;padding:4px 6px;border:1px solid #d1d5db;border-radius:4px;font-size:12px;box-sizing:border-box;font-weight:600" />
                </div>
                <div style="display:flex;gap:6px">
                  <button data-action="save-alt-wp"
                    style="flex:1;display:inline-flex;align-items:center;justify-content:center;padding:5px 4px;background:${ALT_ROUTE_COLOR};color:#fff;border:none;border-radius:4px;font-size:11px;font-weight:600;cursor:pointer">
                    ${escapeHtml(tRef.current('common.save'))}
                  </button>
                  <button data-action="sat-alt-wp"
                    style="flex:0 0 36px;display:inline-flex;align-items:center;justify-content:center;padding:5px;background:#4f46e5;color:#fff;border:none;border-radius:4px;cursor:pointer" title="Satélite">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>
                  </button>
                  <button data-action="remove-alt-wp"
                    style="flex:0 0 36px;display:inline-flex;align-items:center;justify-content:center;padding:5px;background:#dc2626;color:#fff;border:none;border-radius:4px;cursor:pointer" title="${escapeHtml(tRef.current('vfr.removeWaypoint'))}">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                  </button>
                </div>
              </div>
            `).openOn(map);
            const popupEl = popup.getElement() as unknown as DomElement | undefined;
            if (popupEl) {
              popupEl.querySelector?.('button[data-action="save-alt-wp"]')?.addEventListener('click', () => {
                const nameInput = popupEl.querySelector?.('#alt-wp-name');
                const newName = (nameInput?.value as string | undefined)?.trim() || wp.name;
                const curPos = marker.getLatLng();
                if (newName !== wp.name) {
                  onUpdateAltWpRef.current?.(wpIdx, { lat: curPos.lat, lng: curPos.lng, name: newName });
                }
                map.closePopup();
              });
              popupEl.querySelector?.('button[data-action="remove-alt-wp"]')?.addEventListener('click', () => {
                onRemoveAltWpRef.current?.(wpIdx);
                map.closePopup();
              });
              popupEl.querySelector?.('button[data-action="sat-alt-wp"]')?.addEventListener('click', () => {
                const curPos = marker.getLatLng();
                const satUrl = buildSatelliteUrl(curPos.lat, curPos.lng, 0.08, 320, 200);
                map.closePopup();
                Leaf.popup({ closeButton: true, maxWidth: 360 }).setLatLng(curPos).setContent(`
                  <div style="font-family:system-ui,sans-serif;min-width:320px">
                    <div style="font-weight:700;font-size:12px;margin-bottom:2px;color:#1a1d26">${escapeHtml(wp.name)}</div>
                    <div style="font-size:10px;color:#6b7280;margin-bottom:6px">${curPos.lat.toFixed(4)}, ${curPos.lng.toFixed(4)}</div>
                    <img src="${satUrl}" style="width:320px;height:200px;border-radius:4px;border:1px solid #e5e7eb;object-fit:cover;display:block" />
                  </div>
                `).openOn(map);
              });
            }
          });
        });
      }
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
  }, [routeOrigin, routeDestination, routeAlternate, waypointsKey, altWaypointsKey, tocTodPositions, hazardSegments, mapInitialized]);

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

      const zoom = map.getZoom();
      let typesParam = '';
      if (zoom < 6) typesParam = '&types=large_airport';
      else if (zoom < 8) typesParam = '&types=large_airport,medium_airport';
      else if (zoom < 10) typesParam = '&types=large_airport,medium_airport,small_airport,seaplane_base';

      const data = await apiClient.get<Aerodrome[]>(
        `/aerodromes/map?south=${bounds.south}&west=${bounds.west}&north=${bounds.north}&east=${bounds.east}${typesParam}`,
      );

      let enriched: MapAerodrome[] = data.map((a) => ({ ...a, flightCategory: null }));
      if (data.length > 0 && data.length <= MAX_METAR_FETCH) {
        try {
          const icaos = data.map((a) => a.icao).join(',');
          const categories = await apiClient.get<FlightCategoryData[]>(
            `/weather/flight-categories?icaos=${icaos}`,
          );
          const catMap = new Map(categories.map((c) => [c.icao, c]));
          enriched = data.map((a) => {
            const cat = catMap.get(a.icao);
            return {
              ...a,
              flightCategory: cat?.flightCategory ?? null,
              derived: cat?.derived ?? false,
              referenceStation: cat?.referenceStation,
              referenceDistanceNm: cat?.referenceDistanceNm,
            };
          });
        } catch { /* best-effort */ }
      }

      // Clear old markers
      for (const m of markersRef.current) map.removeLayer(m);
      markersRef.current = [];

      // Add new markers
      for (const airport of enriched) {
        const isDerived = airport.derived && airport.flightCategory;
        const color = airport.flightCategory
          ? (CATEGORY_COLORS[airport.flightCategory] ?? DEFAULT_DOT_COLOR)
          : DEFAULT_DOT_COLOR;
        const bgColor = airport.flightCategory
          ? (isDerived
            ? (DERIVED_BG_COLORS[airport.flightCategory!] ?? DEFAULT_BADGE_BG)
            : (CATEGORY_BG_COLORS[airport.flightCategory] ?? DEFAULT_BADGE_BG))
          : DEFAULT_BADGE_BG;
        const borderColor = isDerived
          ? (DERIVED_BORDER_COLORS[airport.flightCategory!] ?? 'rgba(255,255,255,0.12)')
          : 'rgba(255,255,255,0.12)';
        const borderStyle = isDerived ? `1.5px dashed ${borderColor}` : `1px solid ${borderColor}`;
        const dotStyle = isDerived
          ? `width:8px;height:8px;border-radius:4px;border:2px solid ${color};flex-shrink:0`
          : `width:8px;height:8px;border-radius:4px;background:${color};flex-shrink:0`;
        const arrowColor = isDerived ? 'transparent' : bgColor;

        const icon = Leaf.divIcon({
          className: '',
          html: `<div style="transform:translate(-50%,-100%);margin-top:-10px"><div style="display:inline-flex;align-items:center;gap:4px;background:${bgColor};color:#fff;font-size:11px;font-weight:700;padding:3px 7px;border-radius:4px;white-space:nowrap;cursor:pointer;font-family:system-ui,sans-serif;line-height:1;letter-spacing:0.4px;border:${borderStyle}"><span style="${dotStyle}"></span>${escapeHtml(airport.icao)}</div><div style="width:0;height:0;border-left:4px solid transparent;border-right:4px solid transparent;border-top:4px solid ${arrowColor};margin:0 auto"></div></div>`,
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

      {/* Aerodrome chart overlay card — top-left, visible when ≥1 overlay is active */}
      {aerodromeOverlays && aerodromeOverlays.length > 0 ? (
        <View
          style={{
            position: 'absolute', top: 10, left: 10, zIndex: 1000,
            backgroundColor: 'rgba(255,255,255,0.95)', borderRadius: 4,
            borderWidth: 1, borderColor: '#dfe2e8',
            padding: 8, gap: 6, minWidth: 220, maxWidth: 300,
          }}
        >
          {/* One row per active chart */}
          {aerodromeOverlays.map((o) => (
            <View key={o.id} style={{ gap: 3 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={{ fontSize: 11, fontWeight: '700', color: '#1f2937', flex: 1 }} numberOfLines={1}>
                  {o.icao} · {o.chartType} — {o.chartName}
                </Text>
                <Pressable
                  onPress={() => fitToAerodromeOverlay(o.id)}
                  style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 3, borderWidth: 1, borderColor: '#dfe2e8' }}
                >
                  <Text style={{ fontSize: 10, color: '#374151' }}>{t('vfr.chartOverlayFit')}</Text>
                </Pressable>
                <Pressable
                  onPress={() => onCloseAerodromeOverlay?.(o.id)}
                  style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 3, borderWidth: 1, borderColor: '#dfe2e8' }}
                >
                  <Text style={{ fontSize: 12, color: '#374151', lineHeight: 12 }}>✕</Text>
                </Pressable>
              </View>
              {o.approximate ? (
                <View style={{ backgroundColor: '#fef3c7', borderRadius: 3, paddingHorizontal: 6, paddingVertical: 3 }}>
                  <Text style={{ fontSize: 10, color: '#92400e' }}>
                    ⚠ {t('vfr.chartOverlayApproximate')}
                  </Text>
                </View>
              ) : null}
            </View>
          ))}

          {/* Single opacity slider — global to all plotted charts */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, borderTopWidth: 1, borderTopColor: '#eef1f5', paddingTop: 6 }}>
            <Text style={{ fontSize: 10, color: '#6b7280', width: 64 }}>
              {t('vfr.chartOverlayOpacity')}
            </Text>
            <View
              style={{ flex: 1 }}
              ref={(el) => {
                if (!el || Platform.OS !== 'web') return;
                const node = el as unknown as DomElement;
                if (node.querySelector?.('input')) return;
                const doc = (globalThis as Record<string, unknown>).document as DomDocument | undefined;
                if (!doc) return;
                const input = doc.createElement('input') as unknown as {
                  type: string; min: string; max: string; step: string; value: string;
                  style: { cssText: string };
                  oninput: ((e: { target?: { value?: string } }) => void) | null;
                };
                input.type = 'range';
                input.min = '10';
                input.max = '100';
                input.step = '5';
                input.value = String(Math.round(aerodromeOverlayOpacity * 100));
                input.style.cssText = 'width:100%;';
                input.oninput = (e) => {
                  const raw = e.target?.value;
                  const n = raw ? parseInt(raw, 10) : NaN;
                  if (!Number.isNaN(n)) setAerodromeOverlayOpacity(n / 100);
                };
                node.appendChild(input as unknown as DomElement);
              }}
            />
            <Text style={{ fontSize: 10, color: '#6b7280', width: 30, textAlign: 'right' }}>
              {Math.round(aerodromeOverlayOpacity * 100)}%
            </Text>
          </View>
        </View>
      ) : null}

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
          {OPENAIP_AVAILABLE ? (
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
          ) : null}
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

        {/* Weather overlay toggles */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 3, justifyContent: 'flex-end' }}>
          <Pressable
            onPress={() => setShowSigmets((v) => !v)}
            style={{
              backgroundColor: showSigmets ? '#059669' : 'rgba(255,255,255,0.92)',
              borderRadius: 4, borderWidth: 1, borderColor: '#dfe2e8',
              paddingHorizontal: 7, paddingVertical: 4,
            }}
          >
            <Text style={{ fontSize: 9, fontWeight: '600', color: showSigmets ? '#fff' : '#374151' }}>
              {t('vfr.layerSigmet')}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setShowRadar((v) => !v)}
            style={{
              backgroundColor: showRadar ? '#059669' : 'rgba(255,255,255,0.92)',
              borderRadius: 4, borderWidth: 1, borderColor: '#dfe2e8',
              paddingHorizontal: 7, paddingVertical: 4,
            }}
          >
            <Text style={{ fontSize: 9, fontWeight: '600', color: showRadar ? '#fff' : '#374151' }}>
              {t('vfr.layerRadar')}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setShowSatellite((v) => !v)}
            style={{
              backgroundColor: showSatellite ? '#059669' : 'rgba(255,255,255,0.92)',
              borderRadius: 4, borderWidth: 1, borderColor: '#dfe2e8',
              paddingHorizontal: 7, paddingVertical: 4,
            }}
          >
            <Text style={{ fontSize: 9, fontWeight: '600', color: showSatellite ? '#fff' : '#374151' }}>
              {t('vfr.layerSatellite')}
            </Text>
          </Pressable>
        </View>
      </View>

      {/* Right-click hint — top-centred and below the overlay/control cards
          (zIndex 999 < 1000) so it never sits on top of the opacity control. */}
      <View
        pointerEvents="none"
        style={{ position: 'absolute', top: 10, left: 0, right: 0, zIndex: 999, alignItems: 'center' }}
      >
        <View
          style={{
            backgroundColor: 'rgba(255,255,255,0.85)', borderRadius: 4,
            paddingHorizontal: 8, paddingVertical: 3,
          }}
        >
          <Text style={{ fontSize: 10, color: '#9ca3af' }}>{t('vfr.rightClickHint')}</Text>
        </View>
      </View>

      {/* Weather layer legends */}
      {(showRadar || showSatellite) ? (
        <View style={{ position: 'absolute', bottom: 38, left: 8, zIndex: 1000, flexDirection: 'row', gap: 4 }}>
          {showRadar ? (
            <View style={{
              backgroundColor: 'rgba(255,255,255,0.92)', borderRadius: 6,
              borderWidth: 1, borderColor: '#dfe2e8', paddingHorizontal: 8, paddingVertical: 5,
            }}>
              <Text style={{ fontSize: 9, fontWeight: '700', color: '#374151', marginBottom: 4 }}>
                {t('vfr.radarLegendTitle')}
              </Text>
              {PRECIP_LEGEND.map((item, i) => (
                <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 1 }}>
                  <View style={{ width: 14, height: 8, backgroundColor: item.color, borderRadius: 2 }} />
                  <Text style={{ fontSize: 8, color: '#4b5563' }}>{t(item.i18n)}</Text>
                </View>
              ))}
            </View>
          ) : null}
          {showSatellite ? (
            <View style={{
              backgroundColor: 'rgba(255,255,255,0.92)', borderRadius: 6,
              borderWidth: 1, borderColor: '#dfe2e8', paddingHorizontal: 8, paddingVertical: 5,
            }}>
              <Text style={{ fontSize: 9, fontWeight: '700', color: '#374151', marginBottom: 4 }}>
                {t('vfr.satLegendTitle')}
              </Text>
              {SATELLITE_LEGEND.map((item, i) => (
                <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 1 }}>
                  <View style={{ width: 14, height: 8, backgroundColor: item.color, borderRadius: 2 }} />
                  <Text style={{ fontSize: 8, color: '#4b5563' }}>{t(item.i18n)}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}

      {/* Flight category legend */}
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
      ? metar.clouds.map((c) => {
          const name = t(`vfr.cloud${c.cover}` as never) ?? c.cover;
          return c.base > 0 ? `${name} ${c.base.toLocaleString()} ft` : String(name);
        }).join(' / ')
      : '—';

    const nearbyLabel = metar.source === 'nearby' && metar.nearbyFrom
      ? `<div style="font-size:9px;color:#d97706;font-weight:600;margin-bottom:3px">METAR ${escapeHtml(metar.nearbyFrom)} (${metar.nearbyDistanceNm ?? '?'} nm)</div>`
      : '';
    const ageHours = Math.round((Date.now() - new Date(metar.observationTime).getTime()) / 3_600_000);
    const staleLabel = ageHours >= 2
      ? `<div style="font-size:9px;color:#d97706;font-weight:600;margin-bottom:3px">METAR ${ageHours}h</div>`
      : '';

    metarHtml = `
      <div style="margin:6px 0;padding:6px 8px;background:#f1f5f9;border-radius:4px;border:1px solid #e2e8f0">
        ${nearbyLabel}${staleLabel}
        <div style="font-family:monospace;font-size:10px;color:#334155;margin-bottom:5px;word-break:break-all;line-height:1.4">${escapeHtml(metar.raw)}</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px 12px;font-size:10px;color:#475569">
          <span><b>${escapeHtml(t('vfr.wind'))}:</b> ${formatPopupWind(metar.windDirection, metar.windSpeed)}</span>
          <span><b>${escapeHtml(t('vfr.visibility'))}:</b> ${metar.visibility ?? '—'}</span>
          ${metar.ceiling != null ? `<span><b>${escapeHtml(t('vfr.ceiling'))}:</b> ${metar.ceiling} ft</span>` : ''}
          <span><b>${escapeHtml(t('vfr.qnh'))}:</b> ${metar.altimeter ?? '—'} hPa</span>
          <span><b>${escapeHtml(t('vfr.clouds'))}:</b> ${cloudsTxt}</span>
        </div>
      </div>`;
  } else {
    const refInfo = airport.derived && airport.referenceStation && airport.flightCategory
      ? `<div style="margin:6px 0;padding:5px 8px;background:#fffbeb;border-radius:4px;border:1px dashed #d97706">
          <div style="font-size:9px;color:#d97706;font-weight:600;margin-bottom:2px">${escapeHtml(t('vfr.derivedCategory'))}</div>
          <div style="font-size:10px;color:#92400e">Ref: ${escapeHtml(airport.referenceStation)} (${airport.referenceDistanceNm ?? '?'} nm)</div>
        </div>`
      : `<div style="margin:6px 0;font-size:10px;color:#9ca3af;font-style:italic">${escapeHtml(t('vfr.noMetar'))}</div>`;
    metarHtml = refInfo;
  }

  const runwayHtml = runways ? buildRunwayHtml(runways, suggestedRwy, t) : '';

  const derivedBadgeStyle = airport.derived && cat
    ? `display:inline-block;background:transparent;color:${catColor};font-size:10px;font-weight:700;padding:1px 6px;border-radius:3px;margin-left:6px;vertical-align:middle;border:1.5px dashed ${catColor}`
    : '';
  const ownBadgeStyle = `display:inline-block;background:${catColor};color:#fff;font-size:10px;font-weight:700;padding:1px 6px;border-radius:3px;margin-left:6px;vertical-align:middle`;
  const catBadge = cat
    ? `<span style="${airport.derived ? derivedBadgeStyle : ownBadgeStyle}">${cat}${airport.derived ? ' ~' : ''}</span>`
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

