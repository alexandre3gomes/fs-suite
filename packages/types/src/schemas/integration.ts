import { z } from 'zod';

export const SimBriefConnectionSchema = z.object({
  pilotId: z.string().min(1).max(50),
});

export type SimBriefConnectionDto = z.infer<typeof SimBriefConnectionSchema>;

export const SimBriefOfpSchema = z.object({
  ofpId: z.string(),
  originIcao: z.string(),
  destinationIcao: z.string(),
  route: z.string().nullable(),
  aircraftIcaoType: z.string().nullable(),
  fuelPlanned: z.number().nullable(),
  altIcao: z.string().nullable(),
  flightNumber: z.string().nullable(),
  rawData: z.record(z.unknown()).optional(),
});

export type SimBriefOfp = z.infer<typeof SimBriefOfpSchema>;

export const SkyVectorUrlParamsSchema = z.object({
  originIcao: z.string().min(3).max(4),
  destinationIcao: z.string().min(3).max(4),
  route: z.string().optional(),
});

export type SkyVectorUrlParams = z.infer<typeof SkyVectorUrlParamsSchema>;

export const SkyVectorUrlResponseSchema = z.object({
  url: z.string().url(),
});

export type SkyVectorUrlResponse = z.infer<typeof SkyVectorUrlResponseSchema>;
