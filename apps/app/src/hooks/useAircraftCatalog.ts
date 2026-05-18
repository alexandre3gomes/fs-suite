import { useEffect, useState } from 'react';

import type { AircraftSpec } from '../data/aircraftCatalog';
import { AIRCRAFT_CATALOG } from '../data/aircraftCatalog';
import { apiClient } from '../services/api.client';

interface CatalogProfile {
  id: string;
  icaoType: string | null;
  name: string;
  manufacturer: string | null;
  model: string | null;
  emptyWeightKg: number | null;
  mtowKg: number | null;
  fuelCapacityL: number | null;
  fuelBurnLph: number | null;
  cruiseSpeedKts: number | null;
  stations: { id: string; labelKey: string; defaultKg: number; maxKg: number; arm: number }[] | null;
  source: string | null;
}

function profileToSpec(p: CatalogProfile): AircraftSpec | null {
  if (!p.icaoType) return null;
  const nameParts = p.name.split(' ');
  return {
    icaoType: p.icaoType,
    manufacturer: p.manufacturer ?? nameParts[0] ?? '',
    model: p.model ?? nameParts.slice(1).join(' ') ?? p.name,
    emptyWeightKg: p.emptyWeightKg ?? 0,
    mtowKg: p.mtowKg ?? 0,
    fuelCapacityL: p.fuelCapacityL ?? 0,
    fuelBurnLph: p.fuelBurnLph ?? 0,
    cruiseSpeedKts: p.cruiseSpeedKts ?? 0,
    stations: p.stations ?? [],
  };
}

let cachedCatalog: AircraftSpec[] | null = null;

export function useAircraftCatalog() {
  const [catalog, setCatalog] = useState<AircraftSpec[]>(cachedCatalog ?? AIRCRAFT_CATALOG);
  const [loading, setLoading] = useState(!cachedCatalog);

  useEffect(() => {
    if (cachedCatalog) return;
    apiClient
      .get<CatalogProfile[]>('/aircraft-profiles/catalog')
      .then((profiles) => {
        const specs = profiles.map(profileToSpec).filter((s): s is AircraftSpec => s !== null);
        if (specs.length > 0) {
          cachedCatalog = specs;
          setCatalog(specs);
        }
      })
      .catch(() => {
        cachedCatalog = AIRCRAFT_CATALOG;
      })
      .finally(() => setLoading(false));
  }, []);

  return { catalog, loading };
}
