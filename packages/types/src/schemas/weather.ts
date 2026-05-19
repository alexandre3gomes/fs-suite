import { z } from 'zod';

// --- METAR ---

export const MetarCloudSchema = z.object({
  cover: z.string(),
  base: z.number(),
});

export type MetarCloud = z.infer<typeof MetarCloudSchema>;

export const ParsedMetarSchema = z.object({
  icaoId: z.string(),
  raw: z.string(),
  observationTime: z.string(),
  windDirection: z.union([z.number(), z.string(), z.null()]),
  windSpeed: z.number().nullable(),
  windGust: z.number().nullable(),
  visibility: z.string().nullable(),
  altimeter: z.number().nullable(),
  temperature: z.number().nullable(),
  dewpoint: z.number().nullable(),
  clouds: z.array(MetarCloudSchema),
  flightCategory: z.string().nullable(),
  ceiling: z.number().nullable(),
  source: z.enum(['adds', 'noaa-text', 'nearby']),
  nearbyFrom: z.string().optional(),
  nearbyDistanceNm: z.number().optional(),
  // V2 fields
  presentWeather: z.array(z.string()).optional(),
  variableWindDir: z
    .object({ from: z.number(), to: z.number() })
    .optional(),
  remarks: z
    .object({
      windshear: z.string().optional(),
      peakWind: z.string().optional(),
    })
    .optional(),
  decodedText: z.string().optional(),
});

export type ParsedMetar = z.infer<typeof ParsedMetarSchema>;

// --- TAF ---

export const TafForecastPeriodSchema = z.object({
  timeFrom: z.number(),
  timeTo: z.number(),
  timeBec: z.number().nullable(),
  fcstChange: z.string().nullable(),
  probability: z.number().nullable(),
  windDirection: z.number().nullable(),
  windSpeed: z.number().nullable(),
  windGust: z.number().nullable(),
  visibility: z.union([z.number(), z.string(), z.null()]),
  wxString: z.string().nullable(),
  clouds: z.array(z.object({ cover: z.string(), base: z.number().nullable() })),
  flightCategory: z.string().nullable(),
});

export type TafForecastPeriod = z.infer<typeof TafForecastPeriodSchema>;

export const ParsedTafSchema = z.object({
  icaoId: z.string(),
  raw: z.string(),
  issueTime: z.string(),
  validFrom: z.number(),
  validTo: z.number(),
  periods: z.array(TafForecastPeriodSchema),
});

export type ParsedTaf = z.infer<typeof ParsedTafSchema>;

// --- SIGMET ---

export const SigmetHazardTypeSchema = z.enum([
  'TS',
  'TURB',
  'ICE',
  'IFR',
  'MTN_OBSC',
  'OTHER',
]);

export type SigmetHazardType = z.infer<typeof SigmetHazardTypeSchema>;

export const SigmetFeaturePropertiesSchema = z.object({
  id: z.string(),
  hazardType: SigmetHazardTypeSchema,
  rawText: z.string(),
  qualifier: z.string().nullable(),
  validFrom: z.string(),
  validTo: z.string(),
  firId: z.string().nullable(),
  sigmetType: z.enum(['SIGMET', 'AIRMET']),
});

export type SigmetFeatureProperties = z.infer<typeof SigmetFeaturePropertiesSchema>;

export const SigmetCollectionSchema = z.object({
  type: z.literal('FeatureCollection'),
  features: z.array(
    z.object({
      type: z.literal('Feature'),
      geometry: z.unknown(),
      properties: SigmetFeaturePropertiesSchema,
    }),
  ),
});

export type SigmetCollection = z.infer<typeof SigmetCollectionSchema>;

// --- Crosswind Analysis ---

export const RunwayWindComponentSchema = z.object({
  ident: z.string(),
  headwindKts: z.number(),
  crosswindKts: z.number(),
});

export type RunwayWindComponent = z.infer<typeof RunwayWindComponentSchema>;

export const CrosswindAnalysisSchema = z.object({
  icao: z.string(),
  windDirection: z.number().nullable(),
  windSpeed: z.number().nullable(),
  windGust: z.number().nullable(),
  runways: z.array(RunwayWindComponentSchema),
  suggested: z.string().nullable(),
});

export type CrosswindAnalysis = z.infer<typeof CrosswindAnalysisSchema>;
