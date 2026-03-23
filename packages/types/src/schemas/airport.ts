import { z } from 'zod';

export const AirportSchema = z.object({
  icao: z.string().min(3).max(4).toUpperCase(),
  iata: z.string().length(3).nullable(),
  name: z.string().min(1),
  city: z.string().nullable(),
  country: z.string().nullable(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  elevation: z.number().nullable(),
});

export type Airport = z.infer<typeof AirportSchema>;

export const AirportSearchQuerySchema = z.object({
  q: z.string().min(2).max(50),
});

export type AirportSearchQuery = z.infer<typeof AirportSearchQuerySchema>;
