import { z } from 'zod';

import { VfrLayerGeometryType, VfrLayerProvider, VfrLayerType } from '../enums';

/**
 * Normalized descriptor for a published VFR aeronautical layer, independent of
 * country/source. REA/REH/WAC are Brazilian specializations; US/EU/local types
 * use the exact same shape so a new region plugs in without coupling to Brazil.
 * See docs/vfr-layer-model.md.
 */
export const VfrLayerDescriptorSchema = z.object({
  id: z.string().min(1), // stable catalog id, e.g. "br-rea", "br-wac"
  name: z.string().min(1), // human label, e.g. "REA — rotas especiais VFR"
  country: z.string().length(2).toUpperCase(), // ISO 3166-1 alpha-2 (BR, US, ES…)
  region: z.string().nullable(), // sub-national scope, e.g. "TMA-SP" or null = nationwide
  source: z.string().min(1), // human source label, e.g. "DECEA GeoAISWEB"
  sourceUrl: z.string().nullable().optional(), // official source / external chart link
  provider: z.nativeEnum(VfrLayerProvider),
  layerType: z.nativeEnum(VfrLayerType),
  geometryType: z.nativeEnum(VfrLayerGeometryType),
  enabledByDefault: z.boolean().optional(), // whether the layer is on by default in the UI

  // Currency — sources differ, so either an AIRAC cycle or an effective date.
  cycle: z.string().nullable().optional(),
  effectiveDate: z.string().nullable().optional(),

  // Operational metadata (all optional — not every layer carries them).
  minAltitude: z.number().nullable().optional(),
  maxAltitude: z.number().nullable().optional(),
  requiresClearance: z.boolean().optional(),
  mandatory: z.boolean().optional(),

  // Trust / legal.
  isOfficial: z.boolean(), // false for community sources (e.g. OpenAIP)
  disclaimer: z.string().nullable().optional(),

  // How the client reaches the data (decoupled from country). One of these is
  // populated depending on geometryType.
  access: z
    .object({
      endpoint: z.string().nullable().optional(), // REST base, e.g. "/v1/rea"
      wmsUrl: z.string().nullable().optional(),
      wmsLayers: z.string().nullable().optional(),
      tileUrl: z.string().nullable().optional(),
    })
    .optional(),
});

export type VfrLayerDescriptor = z.infer<typeof VfrLayerDescriptorSchema>;
