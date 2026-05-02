import { createContext, useContext, useState, useEffect, useCallback } from "react";
import type { User } from "@shared/schema";
import { apiRequest, queryClient, ensureCSRFToken } from "./queryClient";

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (orgSlug: string, email: string, password: string, options?: { signal?: AbortSignal }) => Promise<void>;
  logout: () => Promise<void>;
  refetchUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/auth/me", { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        setUser(data);
        if (data) ensureCSRFToken();
      })
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (orgSlug: string, email: string, password: string, options?: { signal?: AbortSignal }) => {
    const body: any = { email, password };
    if (orgSlug) body.orgSlug = orgSlug;
    const signal = options?.signal;
    const res = await apiRequest("POST", "/api/auth/login", body, { signal });
    const data = await res.json();
    if (signal?.aborted) {
      throw new DOMException("Login aborted", "AbortError");
    }
    if (data.needsOrgPick) {
      throw new Error(JSON.stringify(data));
    }
    if (orgSlug) {
      try { localStorage.setItem("lastOrgSlug", orgSlug); } catch {}
    }
    queryClient.clear();
    setUser(data);
    await ensureCSRFToken(true);
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiRequest("POST", "/api/auth/logout");
    } finally {
      queryClient.clear();
      setUser(null);
      window.location.href = "/login";
    }
  }, []);

  const refetchUser = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me", { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setUser(data);
      } else if (res.status === 401) {
        setUser(null);
      }
    } catch {}
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, refetchUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
