import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';

import { identifyUser } from '../services/analytics';
import { apiClient } from '../services/api.client';
import { useAuthStore } from '../stores/auth.store';

interface UserProfile {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  isAdmin?: boolean;
  marketingEmailConsent?: boolean;
  locale?: string | null;
}

export function useCurrentUser(): {
  user: UserProfile | null;
  isLoading: boolean;
  error: Error | null;
} {
  const { isAuthenticated, user: storedUser, setUser } = useAuthStore();

  const query = useQuery({
    queryKey: ['users', 'me'],
    queryFn: () => apiClient.get<UserProfile>('/users/me'),
    enabled: isAuthenticated && !storedUser,
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (query.data) {
      setUser(query.data);
      identifyUser(query.data);
    }
  }, [query.data, setUser]);

  return {
    user: storedUser ?? query.data ?? null,
    isLoading: query.isLoading,
    error: query.error,
  };
}
