import type { AircraftCatalogEntry, AnyAircraftProfile, UserAircraftProfile } from '@fs-suite/types';
import { useCallback, useEffect, useRef, useState } from 'react';

import { apiClient } from '../services/api.client';

export type ProfileKind = 'template' | 'shared' | 'mine';

export interface TaggedAircraftProfile {
  kind: ProfileKind;
  profile: AnyAircraftProfile;
}

// Module-level cache so catalog doesn't refetch across remounts.
let cachedCatalog: AircraftCatalogEntry[] | null = null;

export function useAircraftProfiles() {
  const [catalog, setCatalog] = useState<AircraftCatalogEntry[]>(cachedCatalog ?? []);
  const [shared, setShared] = useState<UserAircraftProfile[]>([]);
  const [mine, setMine] = useState<UserAircraftProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fetchedRef = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [catalogRes, sharedRes, mineRes] = await Promise.all([
        cachedCatalog
          ? Promise.resolve(cachedCatalog)
          : apiClient.get<AircraftCatalogEntry[]>('/aircraft-profiles/catalog'),
        apiClient.get<UserAircraftProfile[]>('/aircraft-profiles/shared'),
        apiClient.get<UserAircraftProfile[]>('/aircraft-profiles'),
      ]);
      if (!cachedCatalog && catalogRes.length > 0) cachedCatalog = catalogRes;
      setCatalog(catalogRes);
      setShared(sharedRes);
      setMine(mineRes);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar aeronaves');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    void load();
  }, [load]);

  // Flat list ordered: templates → shared (deduped from mine) → mine
  const entries: TaggedAircraftProfile[] = [
    ...catalog.map((p) => ({ kind: 'template' as const, profile: p })),
    ...shared
      .filter((s) => !mine.some((m) => m.id === s.id))
      .map((p) => ({ kind: 'shared' as const, profile: p })),
    ...mine.map((p) => ({ kind: 'mine' as const, profile: p })),
  ];

  return { entries, catalog, shared, mine, loading, error, refresh: load };
}
