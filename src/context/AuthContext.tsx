import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { PublicUser, UserRole } from '../../packages/shared/types';
import {
  clearAuthToken,
  registerUnauthorizedHandler,
  setAuthToken,
} from '../services/api';

interface AuthContextValue {
  user: PublicUser | null;
  token: string | null;
  currentPath: string;
  navigate: (path: string) => void;
  setSession: (user: PublicUser, token: string) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function roleToDashboardPath(role: UserRole): string {
  switch (role) {
    case 'super-admin':
      return '/dashboard/super-admin';
    case 'admin':
      return '/dashboard/admin';
    case 'agent':
      return '/dashboard/agent';
    case 'customer':
      return '/dashboard/customer';
    case 'support':
      return '/dashboard/support';
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [currentPath, setCurrentPath] = useState<string>(() => window.location.pathname || '/');

  useEffect(() => {
    const onPopState = () => {
      setCurrentPath(window.location.pathname || '/');
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigate = useCallback((path: string) => {
    if (window.location.pathname !== path) {
      window.history.pushState({}, '', path);
    }
    setCurrentPath(path);
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, []);

  const setSession = useCallback((nextUser: PublicUser, nextToken: string) => {
    setAuthToken(nextToken);
    setUser(nextUser);
    setToken(nextToken);
  }, []);

  const logout = useCallback(() => {
    clearAuthToken();
    setUser(null);
    setToken(null);
    navigate('/login');
  }, [navigate]);

  useEffect(() => {
    registerUnauthorizedHandler(() => {
      setUser(null);
      setToken(null);
      navigate('/login');
    });
    return () => registerUnauthorizedHandler(null);
  }, [navigate]);

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        currentPath,
        navigate,
        setSession,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return ctx;
}
