import {
  type VfrLayerDescriptor,
  VfrLayerDescriptorSchema,
  VfrLayerGeometryType,
  VfrLayerProvider,
  VfrLayerType,
} from '@fs-suite/types';
import { describe, expect, it } from 'vitest';

import { listVfrLayers } from './vfr-layers.catalog';

describe('VFR layer catalog', () => {
  it('every catalog entry is a valid VfrLayerDescriptor', () => {
    for (const layer of listVfrLayers()) {
      expect(() => VfrLayerDescriptorSchema.parse(layer)).not.toThrow();
    }
  });

  it('exposes the Brazilian REA + WAC specializations', () => {
    const types = listVfrLayers('BR').map((l) => l.layerType);
    expect(types).toContain(VfrLayerType.BR_REA);
    expect(types).toContain(VfrLayerType.BR_WAC);
  });

  it('REA is official, vector, and points at the existing /v1/rea endpoint', () => {
    const rea = listVfrLayers().find((l) => l.layerType === VfrLayerType.BR_REA);
    expect(rea?.isOfficial).toBe(true);
    expect(rea?.geometryType).toBe(VfrLayerGeometryType.VECTOR_GEOJSON);
    expect(rea?.access?.endpoint).toBe('/v1/rea'); // REA data path unchanged
  });

  it('filters by country and returns nothing for regions not served yet', () => {
    expect(listVfrLayers('BR').every((l) => l.country === 'BR')).toBe(true);
    expect(listVfrLayers('US')).toHaveLength(0);
  });

  it('model accepts future US vector layers with the same shape (no Brazil coupling)', () => {
    // Acceptance: registering US_AIRSPACE / US_REPORTING_POINTS must validate
    // against the same schema, no Brazil-specific logic involved.
    const usLayers: VfrLayerDescriptor[] = [
      {
        id: 'us-airspace',
        name: 'US Airspace (FAA NASR)',
        country: 'US',
        region: null,
        source: 'FAA NASR',
        sourceUrl: 'https://www.faa.gov/air_traffic/flight_info/aeronav/aero_data/NASR_Subscription/',
        provider: VfrLayerProvider.FAA_NASR,
        layerType: VfrLayerType.US_AIRSPACE,
        geometryType: VfrLayerGeometryType.VECTOR_GEOJSON,
        enabledByDefault: false,
        isOfficial: true,
      },
      {
        id: 'us-reporting-points',
        name: 'US VFR Reporting Points',
        country: 'US',
        region: null,
        source: 'FAA NASR',
        provider: VfrLayerProvider.FAA_NASR,
        layerType: VfrLayerType.US_REPORTING_POINTS,
        geometryType: VfrLayerGeometryType.VECTOR_GEOJSON,
        isOfficial: true,
      },
    ];
    for (const layer of usLayers) {
      expect(() => VfrLayerDescriptorSchema.parse(layer)).not.toThrow();
    }
  });

  it('model accepts an external-link official chart (raster never hosted)', () => {
    // FAA VFR raster charts are reached via external link, not hosted.
    const faaChart: VfrLayerDescriptor = {
      id: 'us-faa-vfr-raster',
      name: 'FAA VFR Raster Charts',
      country: 'US',
      region: null,
      source: 'FAA Aeronautical Information Services',
      sourceUrl: 'https://www.faa.gov/air_traffic/flight_info/aeronav/digital_products/vfr/',
      provider: VfrLayerProvider.FAA_VFR_RASTER,
      layerType: VfrLayerType.US_AIRSPACE,
      geometryType: VfrLayerGeometryType.EXTERNAL_LINK,
      isOfficial: true,
    };
    const parsed = VfrLayerDescriptorSchema.parse(faaChart);
    expect(parsed.geometryType).toBe(VfrLayerGeometryType.EXTERNAL_LINK);
    expect(parsed.sourceUrl).toContain('faa.gov');
  });

  it('model carries the non-official disclaimer for community sources', () => {
    const openaip: VfrLayerDescriptor = {
      id: 'local-openaip-example',
      name: 'OpenAIP visual route',
      country: 'DE',
      region: null,
      source: 'OpenAIP (community)',
      provider: VfrLayerProvider.OPENAIP,
      layerType: VfrLayerType.LOCAL_VISUAL_ROUTE,
      geometryType: VfrLayerGeometryType.VECTOR_GEOJSON,
      isOfficial: false,
      disclaimer: 'Community-sourced, not an official aeronautical publication.',
    };
    const parsed = VfrLayerDescriptorSchema.parse(openaip);
    expect(parsed.isOfficial).toBe(false);
    expect(parsed.disclaimer).toBeTruthy();
  });
});
