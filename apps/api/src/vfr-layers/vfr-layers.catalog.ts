import {
  type VfrLayerDescriptor,
  VfrLayerGeometryType,
  VfrLayerProvider,
  VfrLayerType,
} from '@fs-suite/types';

import ptVfrData from '../pt-vfr/data/pt-vfr.json';

// The PT dataset is curated per AIRAC amendment; surface its effective date so
// clients can show currency without fetching the data itself.
const PT_VFR_EFFECTIVE_DATE = (ptVfrData as { effectiveDate: string | null }).effectiveDate;

/**
 * Static catalog of the published VFR layers the app currently exposes,
 * classified under the worldwide model (see docs/vfr-layer-model.md). This is a
 * metadata/discovery layer only — REA data is still served by /v1/rea/*, and
 * WAC tiles are still rendered client-side from DECEA WMS. Adding a new region
 * (e.g. US_VFR_FLYWAY) is just another entry with country !== 'BR'; nothing here
 * is coupled to Brazil.
 *
 * No DB table yet (decision: static-in-code until multi-region data lands).
 */
const CATALOG: readonly VfrLayerDescriptor[] = [
  {
    id: 'br-rea',
    name: 'REA — rotas especiais VFR',
    country: 'BR',
    region: null,
    source: 'DECEA GeoAISWEB',
    sourceUrl: 'https://aisweb.decea.mil.br/?i=cartas&p=visuais',
    provider: VfrLayerProvider.DECEA_GEOAISWEB,
    layerType: VfrLayerType.BR_REA,
    geometryType: VfrLayerGeometryType.VECTOR_GEOJSON,
    enabledByDefault: false,
    cycle: null,
    effectiveDate: null,
    minAltitude: null,
    maxAltitude: null,
    requiresClearance: false,
    mandatory: true, // contains Obrig (mandatory) corridors; enforced per-segment by /v1/rea
    isOfficial: true,
    disclaimer: null,
    access: { endpoint: '/v1/rea' },
  },
  {
    id: 'br-wac',
    name: 'WAC — World Aeronautical Chart (Brasil)',
    country: 'BR',
    region: null,
    source: 'DECEA GeoAISWEB (WMS)',
    sourceUrl: 'https://aisweb.decea.mil.br/?i=cartas&p=visuais',
    provider: VfrLayerProvider.DECEA_GEOAISWEB,
    layerType: VfrLayerType.BR_WAC,
    geometryType: VfrLayerGeometryType.RASTER_WMS,
    enabledByDefault: false,
    cycle: null,
    effectiveDate: null,
    minAltitude: null,
    maxAltitude: null,
    isOfficial: true,
    disclaimer: null,
    // The full per-tile WMS layer list lives client-side today; the client owns
    // rendering. Exposed here as the authoritative endpoint for the layer.
    access: { wmsUrl: 'https://geoaisweb.decea.mil.br/geoserver/ICA/wms', wmsLayers: null },
  },
  {
    id: 'pt-vfr-tunnels',
    name: 'Túneis VFR — Portugal (TMA Lisboa/Porto/Faro)',
    country: 'PT',
    region: null,
    source: 'NAV Portugal — Manual VFR (eVFR), ENR 3.5',
    sourceUrl: 'https://ais.nav.pt/',
    provider: VfrLayerProvider.NATIONAL_AIP,
    layerType: VfrLayerType.EU_VFR_TRANSIT_ROUTE,
    geometryType: VfrLayerGeometryType.VECTOR_GEOJSON,
    enabledByDefault: false,
    cycle: null,
    effectiveDate: PT_VFR_EFFECTIVE_DATE,
    minAltitude: null,
    maxAltitude: null,
    requiresClearance: false,
    mandatory: true, // published tunnels are the mandatory VFR paths inside the Lisboa/Porto/Faro TMAs
    isOfficial: true,
    disclaimer: null,
    access: { endpoint: '/v1/pt-vfr/routes' },
  },
  {
    id: 'pt-vrp',
    name: 'Pontos VFR — Portugal (pontos de notificação visual)',
    country: 'PT',
    region: null,
    source: 'NAV Portugal — Manual VFR (eVFR), ENR 4.4',
    sourceUrl: 'https://ais.nav.pt/',
    provider: VfrLayerProvider.NATIONAL_AIP,
    layerType: VfrLayerType.EU_VRP,
    geometryType: VfrLayerGeometryType.VECTOR_GEOJSON,
    enabledByDefault: false,
    cycle: null,
    effectiveDate: PT_VFR_EFFECTIVE_DATE,
    minAltitude: null,
    maxAltitude: null,
    requiresClearance: false,
    mandatory: false,
    isOfficial: true,
    disclaimer: null,
    access: { endpoint: '/v1/pt-vfr/points' },
  },
];

/** List catalog descriptors, optionally filtered by ISO alpha-2 country. */
export function listVfrLayers(country?: string): VfrLayerDescriptor[] {
  if (!country) return [...CATALOG];
  const c = country.trim().toUpperCase();
  return CATALOG.filter((layer) => layer.country === c);
}
