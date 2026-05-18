import { z } from 'zod';

export const WeightStationSchema = z.object({
  id: z.string(),
  labelKey: z.string(),
  defaultKg: z.number(),
  maxKg: z.number(),
  arm: z.number(),
});

export type WeightStation = z.infer<typeof WeightStationSchema>;

export const AircraftProfileSchema = z.object({
  id: z.string().cuid(),
  name: z.string().min(1).max(100),
  icaoType: z.string().max(4).nullable(),
  manufacturer: z.string().nullable(),
  model: z.string().nullable(),
  emptyWeightKg: z.number().nullable(),
  mtowKg: z.number().nullable(),
  fuelCapacityL: z.number().nullable(),
  fuelBurnLph: z.number().nullable(),
  cruiseSpeedKts: z.number().int().positive().nullable(),
  stations: z.array(WeightStationSchema).nullable(),
  source: z.string().nullable(),
  isTemplate: z.boolean(),
  clonedFromId: z.string().nullable().optional(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export type AircraftProfile = z.infer<typeof AircraftProfileSchema>;

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

export type CreateAircraftProfileDto = z.infer<typeof CreateAircraftProfileSchema>;

export const UpdateAircraftProfileSchema = CreateAircraftProfileSchema.partial();
export type UpdateAircraftProfileDto = z.infer<typeof UpdateAircraftProfileSchema>;
