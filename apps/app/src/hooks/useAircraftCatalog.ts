import type { AircraftCatalogEntry } from '@fs-suite/types';
import { useEffect, useState } from 'react';

import { apiClient } from '../services/api.client';

let cachedCatalog: AircraftCatalogEntry[] | null = null;

export function useAircraftCatalog() {
  const hasCached = cachedCatalog != null && cachedCatalog.length > 0;
  const [catalog, setCatalog] = useState<AircraftCatalogEntry[]>(hasCached ? cachedCatalog! : []);
  const [loading, setLoading] = useState(!hasCached);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (hasCached) return;
    apiClient
      .get<AircraftCatalogEntry[]>('/aircraft-profiles/catalog')
      .then((profiles) => {
        if (profiles.length > 0) {
          cachedCatalog = profiles;
        }
        setCatalog(profiles);
        setError(null);
      })
      .catch((err: Error) => {
        setError(err.message ?? 'Falha ao carregar catálogo de aeronaves');
      })
      .finally(() => setLoading(false));
  }, [hasCached]);

  return { catalog, loading, error };
}
