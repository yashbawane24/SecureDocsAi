import React, { createContext, useContext, useState, useEffect } from 'react';
import { User, api } from '../api/client';
import { queryClient, queryKeys } from '../api/queryKeys';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (email: string, pass: string) => Promise<User>;
  signup: (data: { org_name: string; full_name: string; email: string; password: string }) => Promise<User>;
  join: (data: { invite_code: string; full_name: string; email: string; password: string }) => Promise<User>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  hasPermission: (permKey: string) => boolean;
  theme: 'light' | 'dark';
  toggleTheme: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  const applyAccent = (color?: string | null) => {
    // Enforce navy + cyan / blue control-room palette (never legacy green #1E6B52)
    if (
      color &&
      /^#[0-9A-Fa-f]{6}$/.test(color) &&
      color.toUpperCase() !== '#1E6B52'
    ) {
      document.documentElement.style.setProperty('--accent', color);
    } else {
      document.documentElement.style.setProperty('--accent', '#2457D6');
    }
  };

  const refreshUser = async () => {
    try {
      const me = await api.getMe();
      setUser(me);
      applyAccent(me.brand_accent_color || me.organization?.brand_accent_color);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshUser();
    const savedTheme = (localStorage.getItem('securedocs-theme') || localStorage.getItem('lv_theme')) as 'light' | 'dark' | null;
    if (savedTheme === 'dark' || savedTheme === 'light') {
      setTheme(savedTheme);
      document.documentElement.setAttribute('data-theme', savedTheme);
    } else {
      document.documentElement.setAttribute('data-theme', 'light');
    }
  }, []);

  // Live SSE Event Stream with 20s polling fallback (PART A5)
  useEffect(() => {
    if (!user) return;

    let es: EventSource | null = null;
    let fallbackPollTimer: ReturnType<typeof setInterval> | null = null;

    const startFallbackPolling = () => {
      if (fallbackPollTimer) return;
      fallbackPollTimer = setInterval(() => {
        queryClient.invalidateQueries({ queryKey: queryKeys.notifications });
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboardMetrics });
        queryClient.invalidateQueries({ queryKey: queryKeys.approvalsAll });
      }, 20_000);
    };

    try {
      es = new EventSource('/api/events/stream', { withCredentials: true });

      const handleEvent = () => {
        queryClient.invalidateQueries({ queryKey: queryKeys.notifications });
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboardMetrics });
        queryClient.invalidateQueries({ queryKey: queryKeys.documentsAll });
        queryClient.invalidateQueries({ queryKey: queryKeys.myShares });
        queryClient.invalidateQueries({ queryKey: queryKeys.sharedWithMe });
        queryClient.invalidateQueries({ queryKey: queryKeys.approvalsAll });
        queryClient.invalidateQueries({ queryKey: queryKeys.membersAll });
      };

      es.onmessage = handleEvent;
      es.addEventListener('notification.created', handleEvent);
      es.addEventListener('share.revoked', handleEvent);
      es.addEventListener('scan.progress', handleEvent);
      es.addEventListener('scan.completed', handleEvent);
      es.addEventListener('approval.created', handleEvent);
      es.addEventListener('approval.updated', handleEvent);
      es.addEventListener('member_updated', handleEvent);

      es.onerror = () => {
        startFallbackPolling();
      };
    } catch {
      startFallbackPolling();
    }

    return () => {
      if (es) es.close();
      if (fallbackPollTimer) clearInterval(fallbackPollTimer);
    };
  }, [user?.id]);

  const toggleTheme = () => {
    const nextTheme = theme === 'light' ? 'dark' : 'light';
    setTheme(nextTheme);
    localStorage.setItem('securedocs-theme', nextTheme);
    localStorage.setItem('lv_theme', nextTheme);
    document.documentElement.setAttribute('data-theme', nextTheme);
  };

  const login = async (email: string, pass: string) => {
    const loggedUser = await api.login(email, pass);
    setUser(loggedUser);
    applyAccent(loggedUser.brand_accent_color || loggedUser.organization?.brand_accent_color);
    queryClient.clear();
    return loggedUser;
  };

  const signup = async (data: { org_name: string; full_name: string; email: string; password: string }) => {
    const newUser = await api.signup(data);
    setUser(newUser);
    queryClient.clear();
    return newUser;
  };

  const join = async (data: { invite_code: string; full_name: string; email: string; password: string }) => {
    const pendingUser = await api.join(data);
    setUser(pendingUser);
    queryClient.clear();
    return pendingUser;
  };

  const logout = async () => {
    try {
      await api.logout();
    } finally {
      setUser(null);
      queryClient.clear();
      applyAccent('#2457D6');
    }
  };

  const hasPermission = (permKey: string): boolean => {
    if (!user) return false;
    if (user.role === 'Owner') return true;
    if (Array.isArray(user.permissions)) {
      return user.permissions.includes(permKey);
    }
    if (user.role === 'Admin') return true;

    if (user.role === 'Department Head') {
      return [
        'documents.upload', 'documents.delete_own', 'documents.view_all_in_scope',
        'shares.create_internal', 'shares.create_external', 'shares.allow_download',
        'shares.revoke_any_in_scope', 'audit.view', 'members.invite', 'members.approve', 'departments.manage'
      ].includes(permKey);
    }
    if (user.role === 'Manager') {
      return [
        'documents.upload', 'documents.delete_own', 'shares.create_internal',
        'shares.allow_download', 'shares.revoke_any_in_scope'
      ].includes(permKey);
    }
    if (user.role === 'Employee') {
      return ['documents.upload', 'documents.delete_own'].includes(permKey);
    }
    return false;
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, signup, join, logout, refreshUser, hasPermission, theme, toggleTheme }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
};
