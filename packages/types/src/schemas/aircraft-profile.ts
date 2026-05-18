import { z } from 'zod';

// --- Enums ---

export const DataCompleteness = {
  SKELETON: 'skeleton',
  PARTIAL: 'partial',
  COMPLETE: 'complete',
} as const;

export type DataCompleteness = (typeof DataCompleteness)[keyof typeof DataCompleteness];

export const DataCompletenessSchema = z.enum(['skeleton', 'partial', 'complete']);

export const EnrichmentSource = {
  CURATED: 'curated',
  SIMBRIEF: 'simbrief',
  OPENAP: 'openap',
  LNM: 'lnm',
  POH_AI: 'poh_ai',
  USER: 'user',
} as const;

export type EnrichmentSource = (typeof EnrichmentSource)[keyof typeof EnrichmentSource];

export const EnrichmentSourceSchema = z.enum([
  'curated',
  'simbrief',
  'openap',
  'lnm',
  'poh_ai',
  'user',
]);

// --- Weight & Balance Station ---

export const WeightStationSchema = z.object({
  id: z.string(),
  labelKey: z.string(),
  defaultKg: z.number(),
  maxKg: z.number(),
  arm: z.number(),
});

export type WeightStation = z.infer<typeof WeightStationSchema>;

// --- Base fields shared by catalog entries and user profiles ---

const AircraftBaseFieldsSchema = z.object({
  id: z.string(),
  name: z.string(),
  icaoType: z.string().nullable(),
  manufacturer: z.string().nullable(),
  model: z.string().nullable(),
  emptyWeightKg: z.number().nullable(),
  mtowKg: z.number().nullable(),
  fuelCapacityL: z.number().nullable(),
  fuelBurnLph: z.number().nullable(),
  cruiseSpeedKts: z.number().nullable(),
  stations: z.array(WeightStationSchema).nullable(),
  source: EnrichmentSourceSchema.nullable(),
  dataCompleteness: DataCompletenessSchema,
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export type AircraftBaseFields = z.infer<typeof AircraftBaseFieldsSchema>;

// --- Catalog entry (system-managed template, read-only for users) ---

export const AircraftCatalogEntrySchema = AircraftBaseFieldsSchema.extend({
  isTemplate: z.literal(true),
});

export type AircraftCatalogEntry = z.infer<typeof AircraftCatalogEntrySchema>;

// --- User aircraft profile (cloned from catalog or created manually) ---

export const UserAircraftProfileSchema = AircraftBaseFieldsSchema.extend({
  isTemplate: z.literal(false),
  clonedFromId: z.string().nullable(),
});

export type UserAircraftProfile = z.infer<typeof UserAircraftProfileSchema>;

// --- Flight Plan Aircraft Snapshot (frozen at plan save time) ---

export const FlightPlanAircraftSnapshotSchema = z.object({
  aircraftType: z.string().nullable(),
  aircraftName: z.string().nullable(),
  emptyWeightKg: z.number().nullable(),
  takeoffWeightKg: z.number().nullable(),
  mtowKg: z.number().nullable(),
  fuelCapacityL: z.number().nullable(),
  fuelBurnLph: z.number().nullable(),
  cruiseSpeedKts: z.number().nullable(),
  aircraftStations: z.array(WeightStationSchema).nullable(),
  callsign: z.string().nullable(),
  registration: z.string().nullable(),
  simbriefOfpId: z.string().nullable(),
  dataCompleteness: DataCompletenessSchema.nullable(),
});

export type FlightPlanAircraftSnapshot = z.infer<typeof FlightPlanAircraftSnapshotSchema>;

// --- Data completeness helpers ---

export function computeDataCompleteness(entry: {
  emptyWeightKg?: number | null;
  mtowKg?: number | null;
  fuelCapacityL?: number | null;
  fuelBurnLph?: number | null;
  cruiseSpeedKts?: number | null;
  stations?: unknown[] | null;
}): DataCompleteness {
  const coreFields = [
    entry.emptyWeightKg,
    entry.mtowKg,
    entry.fuelCapacityL,
    entry.fuelBurnLph,
    entry.cruiseSpeedKts,
  ];
  const presentCount = coreFields.filter((v) => v != null).length;
  const hasStations = Array.isArray(entry.stations) && entry.stations.length > 0;

  if (presentCount === 0) return DataCompleteness.SKELETON;
  if (presentCount === coreFields.length && hasStations) return DataCompleteness.COMPLETE;
  return DataCompleteness.PARTIAL;
}

export function hasWeightData(entry: AircraftBaseFields): boolean {
  return entry.emptyWeightKg != null && entry.mtowKg != null;
}

export function hasPerformanceData(entry: AircraftBaseFields): boolean {
  return entry.fuelBurnLph != null && entry.cruiseSpeedKts != null && entry.fuelCapacityL != null;
}

export function hasStationData(entry: AircraftBaseFields): boolean {
  return Array.isArray(entry.stations) && entry.stations.length > 0;
}

// --- Input contracts (shared source of truth for create/update payloads) ---

export const CreateAircraftProfileSchema = z.object({
  name: z.string().min(1).max(100),
  icaoType: z.string().max(4).optional(),
  manufacturer: z.string().max(50).optional(),
  model: z.string().max(100).optional(),
  emptyWeightKg: z.number().optional(),
  mtowKg: z.number().optional(),
  fuelCapacityL: z.number().optional(),
  fuelBurnLph: z.number().optional(),
  cruiseSpeedKts: z.number().int().positive().optional(),
  stations: z.array(WeightStationSchema).optional(),
});

export type CreateAircraftProfileInput = z.infer<typeof CreateAircraftProfileSchema>;

export const UpdateAircraftProfileSchema = CreateAircraftProfileSchema.partial();
export type UpdateAircraftProfileInput = z.infer<typeof UpdateAircraftProfileSchema>;
