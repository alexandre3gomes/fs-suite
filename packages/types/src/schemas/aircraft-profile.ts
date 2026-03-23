import { z } from 'zod';

export const AircraftProfileSchema = z.object({
  id: z.string().cuid(),
  name: z.string().min(1).max(100),
  icaoType: z.string().max(4).nullable(),
  cruiseSpeed: z.number().int().positive().nullable(),
  fuelUnit: z.enum(['kg', 'lbs', 'liters']).nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export type AircraftProfile = z.infer<typeof AircraftProfileSchema>;

export const CreateAircraftProfileSchema = z.object({
  name: z.string().min(1).max(100),
  icaoType: z.string().max(4).optional(),
  cruiseSpeed: z.number().int().positive().optional(),
  fuelUnit: z.enum(['kg', 'lbs', 'liters']).optional(),
});

export type CreateAircraftProfileDto = z.infer<typeof CreateAircraftProfileSchema>;

export const UpdateAircraftProfileSchema = CreateAircraftProfileSchema.partial();
export type UpdateAircraftProfileDto = z.infer<typeof UpdateAircraftProfileSchema>;
