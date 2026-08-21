'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';

import {
  API_URL,
  api,
  clearStoredUser,
  clearToken,
  getStoredUser,
  getToken,
  setToken,
  storeUser,
} from './api';
import type { AuthResponse, User } from './types';

interface AuthContextValue {
  user: User | null;
  initializing: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name?: string) => Promise<void>;
  loginWithGoogle: () => void;
  completeGoogleLogin: (token: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function persistSession(res: AuthResponse): void {
  setToken(res.token);
  storeUser(res.user);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(() => getStoredUser<User>());
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
    let active = true;

    const initializeAuth = async () => {
      // On the OAuth callback page the token is in ?token= and hasn't been
      // persisted to localStorage yet — don't wipe it by treating "no token"
      // as unauthenticated. Let OAuthCallbackPage own the flow.
      if (typeof window !== 'undefined' && window.location.pathname.startsWith('/oauth')) {
        if (active) setInitializing(false);
        return;
      }

      const token = getToken();

      if (!token) {
        if (active) {
          setUser(null);
          setInitializing(false);
        }
        return;
      }

      try {
        const data = await api<{ user: User }>('/auth/me');

        if (!active) return;

        setUser(data.user);
        storeUser(data.user);
      } catch (error) {
        console.error('[auth] session validation failed on startup', error);
        // Don't clear token if we're mid-OAuth hand-off (token just set but
        // /auth/me hasn't succeeded yet) — the callback page will handle it.
        if (typeof window !== 'undefined' && window.location.pathname.startsWith('/oauth')) {
          if (active) setInitializing(false);
          return;
        }
        clearToken();
        clearStoredUser();

        if (active) {
          setUser(null);
        }
      } finally {
        if (active) {
          setInitializing(false);
        }
      }
    };

    void initializeAuth();

    return () => {
      active = false;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api<AuthResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });

    persistSession(res);
    setUser(res.user);
  }, []);

  const register = useCallback(
    async (email: string, password: string, name?: string) => {
      const res = await api<AuthResponse>('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email, password, name }),
      });

      persistSession(res);
      setUser(res.user);
    },
    [],
  );

  const loginWithGoogle = useCallback(() => {
    if (!API_URL) {
      console.error('NEXT_PUBLIC_API_URL is not configured');
      return;
    }
    window.location.href = `${API_URL}/auth/google`;
  }, []);

  const completeGoogleLogin = useCallback(async (token: string) => {
    // Store the JWT BEFORE calling /auth/me so api() can attach
    // Authorization: Bearer <token>.
    setToken(token);

    try {
      const data = await api<{ user: User }>('/auth/me');

      storeUser(data.user);
      setUser(data.user);
    } catch (error) {
      console.error('[auth] Google login validation failed', error);
      clearToken();
      clearStoredUser();
      setUser(null);

      // Important: let OAuthCallbackPage know that authentication failed.
      throw error;
    }
  }, []);

  const logout = useCallback(() => {
    void api('/auth/logout', { method: 'POST' }).catch(() => undefined);

    clearToken();
    clearStoredUser();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        initializing,
        login,
        register,
        loginWithGoogle,
        completeGoogleLogin,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);

  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }

  return ctx;
}