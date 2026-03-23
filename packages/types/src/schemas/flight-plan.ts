import { z } from 'zod';

import { FlightType, PlanStatus } from '../enums';

import { AircraftProfileSchema } from './aircraft-profile';
import { AirportSchema } from './airport';

export const FlightPlanRouteSchema = z.object({
  id: z.string().cuid(),
  sequence: z.number().int().min(0),
  waypointIdent: z.string().min(1).max(10),
  latitude: z.number().min(-90).max(90).nullable(),
  longitude: z.number().min(-180).max(180).nullable(),
  airway: z.string().max(10).nullable(),
});

export type FlightPlanRoute = z.infer<typeof FlightPlanRouteSchema>;

export const FlightPlanSchema = z.object({
  id: z.string().cuid(),
  status: z.nativeEnum(PlanStatus),
  flightType: z.nativeEnum(FlightType),
  plannedAltitude: z.number().int().positive().nullable(),
  remarks: z.string().max(500).nullable(),
  simBriefOfpId: z.string().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  originIcao: z.string(),
  destinationIcao: z.string(),
  aircraftProfileId: z.string().cuid().nullable(),
  origin: AirportSchema.optional(),
  destination: AirportSchema.optional(),
  aircraftProfile: AircraftProfileSchema.optional().nullable(),
  routes: z.array(FlightPlanRouteSchema).optional(),
});

export type FlightPlan = z.infer<typeof FlightPlanSchema>;

export const CreateFlightPlanSchema = z.object({
  flightType: z.nativeEnum(FlightType),
  originIcao: z.string().min(3).max(4),
  destinationIcao: z.string().min(3).max(4),
  plannedAltitude: z.number().int().positive().optional(),
  aircraftProfileId: z.string().cuid().optional(),
  remarks: z.string().max(500).optional(),
  routes: z
    .array(
      z.object({
        sequence: z.number().int().min(0),
        waypointIdent: z.string().min(1).max(10),
        latitude: z.number().min(-90).max(90).optional(),
        longitude: z.number().min(-180).max(180).optional(),
        airway: z.string().max(10).optional(),
      }),
    )
    .optional(),
});

export type CreateFlightPlanDto = z.infer<typeof CreateFlightPlanSchema>;

export const UpdateFlightPlanSchema = CreateFlightPlanSchema.partial().extend({
  status: z.nativeEnum(PlanStatus).optional(),
});

export type UpdateFlightPlanDto = z.infer<typeof UpdateFlightPlanSchema>;

export const FlightPlanListItemSchema = FlightPlanSchema.pick({
  id: true,
  status: true,
  flightType: true,
  originIcao: true,
  destinationIcao: true,
  plannedAltitude: true,
  createdAt: true,
  updatedAt: true,
});

export type FlightPlanListItem = z.infer<typeof FlightPlanListItemSchema>;
