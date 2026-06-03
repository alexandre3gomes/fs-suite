import {
  type VfrLayerDescriptor,
  VfrLayerGeometryType,
  VfrLayerProvider,
  VfrLayerType,
} from '@fs-suite/types';

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
];

/** List catalog descriptors, optionally filtered by ISO alpha-2 country. */
export function listVfrLayers(country?: string): VfrLayerDescriptor[] {
  if (!country) return [...CATALOG];
  const c = country.trim().toUpperCase();
  return CATALOG.filter((layer) => layer.country === c);
}
