import type { AircraftCatalogEntry } from '@fs-suite/types';
import { useEffect, useState } from 'react';

import { apiClient } from '../services/api.client';

let cachedCatalog: AircraftCatalogEntry[] | null = null;

export function useAircraftCatalog() {
  const [catalog, setCatalog] = useState<AircraftCatalogEntry[]>(cachedCatalog ?? []);
  const [loading, setLoading] = useState(!cachedCatalog);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (cachedCatalog) return;
    apiClient
      .get<AircraftCatalogEntry[]>('/aircraft-profiles/catalog')
      .then((profiles) => {
        cachedCatalog = profiles;
        setCatalog(profiles);
        setError(null);
      })
      .catch((err: Error) => {
        setError(err.message ?? 'Falha ao carregar catálogo de aeronaves');
      })
      .finally(() => setLoading(false));
  }, []);

  return { catalog, loading, error };
}
