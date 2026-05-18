import { z } from 'zod';

import { FlightRules, PlanStatus } from '../enums';

// --- Child collections ---

export const FlightPlanRouteSchema = z.object({
  id: z.string().cuid(),
  sequence: z.number().int().min(0),
  waypointIdent: z.string().min(1).max(50),
  latitude: z.number().min(-90).max(90).nullable(),
  longitude: z.number().min(-180).max(180).nullable(),
  airway: z.string().max(10).nullable(),
});

export type FlightPlanRoute = z.infer<typeof FlightPlanRouteSchema>;

export const VisualReferenceSchema = z.object({
  id: z.string().cuid(),
  sequence: z.number().int().min(0),
  name: z.string().max(200),
  distanceNm: z.number().nullable(),
  timeMin: z.number().int().nullable(),
});

export type VisualReference = z.infer<typeof VisualReferenceSchema>;

export const BriefingItemSchema = z.object({
  id: z.string().cuid(),
  code: z.string().max(50),
  label: z.string().max(200),
  checked: z.boolean(),
  notes: z.string().max(500).nullable(),
});

export type BriefingItem = z.infer<typeof BriefingItemSchema>;

// --- FlightPlan response schema (matches Prisma model) ---

export const FlightPlanSchema = z.object({
  id: z.string().cuid(),
  userId: z.string().cuid(),
  status: z.nativeEnum(PlanStatus),
  flightRules: z.nativeEnum(FlightRules),

  // Origin snapshot
  originIcao: z.string(),
  originName: z.string(),
  originElevationFt: z.number().int().nullable(),
  originRunwayInUse: z.string().nullable(),
  originMetarRaw: z.string().nullable(),

  // Destination snapshot
  destinationIcao: z.string(),
  destinationName: z.string(),
  destinationElevationFt: z.number().int().nullable(),
  destinationRunwayInUse: z.string().nullable(),
  destinationMetarRaw: z.string().nullable(),

  // Alternate snapshot
  alternateIcao: z.string().nullable(),
  alternateName: z.string().nullable(),
  alternateElevationFt: z.number().int().nullable(),
  alternateRunwayInUse: z.string().nullable(),
  alternateMetarRaw: z.string().nullable(),

  // Aircraft (snapshot)
  aircraftType: z.string().nullable(),
  aircraftName: z.string().nullable(),
  emptyWeightKg: z.number().nullable(),
  takeoffWeightKg: z.number().nullable(),
  mtowKg: z.number().nullable(),
  fuelCapacityL: z.number().nullable(),
  fuelBurnLph: z.number().nullable(),
  aircraftStations: z.unknown().nullable(),
  callsign: z.string().nullable(),
  registration: z.string().nullable(),
  simbriefOfpId: z.string().nullable(),

  // Route
  routeText: z.string().nullable(),
  cruiseLevel: z.string().nullable(),
  plannedAltitude: z.number().int().nullable(),
  remarks: z.string().nullable(),
  todMinutes: z.number().int().nullable(),
  todDistanceNm: z.number().nullable(),

  // Fuel
  fuelConsumptionPerHour: z.number().nullable(),
  fuelCurrentTotal: z.number().nullable(),
  fuelReserveMinutes: z.number().int().nullable(),
  fuelRequiredTotal: z.number().nullable(),
  fuelPerWing: z.number().nullable(),
  enduranceMinutes: z.number().int().nullable(),

  // Timestamps
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  deletedAt: z.coerce.date().nullable(),

  // Relations (optional in responses)
  routes: z.array(FlightPlanRouteSchema).optional(),
  visualReferences: z.array(VisualReferenceSchema).optional(),
  briefingItems: z.array(BriefingItemSchema).optional(),
});

export type FlightPlan = z.infer<typeof FlightPlanSchema>;

// --- Create input (canonical fields only, no aiValidation) ---

export const CreateFlightPlanSchema = z.object({
  flightRules: z.nativeEnum(FlightRules).optional(),

  // Origin (required)
  originIcao: z.string().min(2).max(4),
  originName: z.string().min(1),
  originElevationFt: z.number().int().optional(),
  originRunwayInUse: z.string().optional(),
  originMetarRaw: z.string().optional(),

  // Destination (required)
  destinationIcao: z.string().min(2).max(4),
  destinationName: z.string().min(1),
  destinationElevationFt: z.number().int().optional(),
  destinationRunwayInUse: z.string().optional(),
  destinationMetarRaw: z.string().optional(),

  // Alternate (optional)
  alternateIcao: z.string().optional(),
  alternateName: z.string().optional(),
  alternateElevationFt: z.number().int().optional(),
  alternateRunwayInUse: z.string().optional(),
  alternateMetarRaw: z.string().optional(),

  // Aircraft (snapshot)
  aircraftType: z.string().optional(),
  aircraftName: z.string().optional(),
  emptyWeightKg: z.number().optional(),
  takeoffWeightKg: z.number().optional(),
  mtowKg: z.number().optional(),
  fuelCapacityL: z.number().optional(),
  fuelBurnLph: z.number().optional(),
  aircraftStations: z.unknown().optional(),
  callsign: z.string().max(20).optional(),
  registration: z.string().max(20).optional(),
  simbriefOfpId: z.string().max(100).optional(),

  // Route
  routeText: z.string().optional(),
  cruiseLevel: z.string().optional(),
  plannedAltitude: z.number().int().positive().optional(),
  remarks: z.string().max(500).optional(),
  todMinutes: z.number().int().min(0).optional(),
  todDistanceNm: z.number().min(0).optional(),

  // Fuel
  fuelConsumptionPerHour: z.number().optional(),
  fuelCurrentTotal: z.number().optional(),
  fuelReserveMinutes: z.number().int().optional(),
  fuelRequiredTotal: z.number().optional(),
  fuelPerWing: z.number().optional(),
  enduranceMinutes: z.number().int().min(0).optional(),

  // Child collections
  routes: z
    .array(
      z.object({
        sequence: z.number().int().min(0),
        waypointIdent: z.string().min(1).max(50),
        latitude: z.number().min(-90).max(90).optional(),
        longitude: z.number().min(-180).max(180).optional(),
        airway: z.string().max(10).optional(),
      }),
    )
    .optional(),

  visualReferences: z
    .array(
      z.object({
        sequence: z.number().int().min(0),
        name: z.string().max(200),
        distanceNm: z.number().optional(),
        timeMin: z.number().int().min(0).optional(),
      }),
    )
    .optional(),

  briefingItems: z
    .array(
      z.object({
        code: z.string().max(50),
        label: z.string().max(200),
        checked: z.boolean().optional(),
        notes: z.string().max(500).optional(),
      }),
    )
    .optional(),
});

export type CreateFlightPlanDto = z.infer<typeof CreateFlightPlanSchema>;

// --- Update input ---

export const UpdateFlightPlanSchema = CreateFlightPlanSchema.partial().extend({
  status: z.nativeEnum(PlanStatus).optional(),
});

export type UpdateFlightPlanDto = z.infer<typeof UpdateFlightPlanSchema>;

// --- List item (summary) ---

export const FlightPlanListItemSchema = FlightPlanSchema.pick({
  id: true,
  status: true,
  flightRules: true,
  originIcao: true,
  originName: true,
  destinationIcao: true,
  destinationName: true,
  createdAt: true,
  updatedAt: true,
});

export type FlightPlanListItem = z.infer<typeof FlightPlanListItemSchema>;
