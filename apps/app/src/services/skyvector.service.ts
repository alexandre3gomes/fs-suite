import { apiClient } from './api.client';

/** Aerodrome shape (structurally compatible with the form's Aerodrome). */
export interface ImportedAerodrome {
  icao: string;
  iata: string | null;
  name: string;
  city: string | null;
  country: string | null;
  latitude: number;
  longitude: number;
  elevation: number | null;
  type: string | null;
}

export interface FplImportResult {
  routeName: string | null;
  origin: ImportedAerodrome | null;
  originIdent: string;
  destination: ImportedAerodrome | null;
  destinationIdent: string;
  waypoints: { name: string; lat: number; lng: number }[];
  /** Origin/destination idents not found in our DB — user must pick them. */
  unresolved: string[];
}

export const skyVectorApi = {
  /** Import a Garmin/SkyVector .fpl: returns resolved origin/destination + route waypoints. */
  importFpl: (fpl: string): Promise<FplImportResult> =>
    apiClient.post('/integrations/skyvector/import', { fpl }),
};
