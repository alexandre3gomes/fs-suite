import { create } from 'zustand';

interface AuthUser {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  isAdmin?: boolean;
  marketingEmailConsent?: boolean;
}

interface AuthState {
  accessToken: string | null;
  user: AuthUser | null;
  isAuthenticated: boolean;
  setTokens: (accessToken: string) => void;
  setUser: (user: AuthUser) => void;
  clear: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  user: null,
  isAuthenticated: false,

  setTokens: (accessToken: string): void => {
    set({ accessToken, isAuthenticated: true });
  },

  setUser: (user: AuthUser): void => {
    set({ user });
  },

  clear: (): void => {
    set({ accessToken: null, user: null, isAuthenticated: false });
  },
}));
