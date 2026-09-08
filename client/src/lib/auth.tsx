import { createContext, useContext, useState, useEffect, useCallback, startTransition } from "react";
import type { User } from "@shared/schema";
import { apiRequest, queryClient, ensureCSRFToken } from "./queryClient";

export type LoginResult =
  | { kind: "mfa-code"; requiresMfaCode: true }
  | { kind: "mfa-setup"; requiresMfaSetup: true }
  | { kind: "user"; user: User };

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (
    orgSlug: string,
    email: string,
    password: string,
    options?: { signal?: AbortSignal },
  ) => Promise<LoginResult>;
  logout: () => Promise<void>;
  refetchUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

/** The auth context if an AuthProvider is above, else null (for providers used both inside and outside it). */
export function useAuthOptional(): AuthContextType | null {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // The resolved state is applied in a transition: on a pre-rendered "/" the
    // marketing home is still a hydrating Suspense boundary when this resolves, and a
    // synchronous update there makes React discard the server HTML and client-render
    // it (recoverable error #421). A transition lets hydration finish first.
    fetch("/api/auth/me", { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        startTransition(() => { setUser(data); setLoading(false); });
        if (data) ensureCSRFToken();
      })
      .catch(() => startTransition(() => { setUser(null); setLoading(false); }));
  }, []);

  const login = useCallback(async (
    orgSlug: string,
    email: string,
    password: string,
    options?: { signal?: AbortSignal },
  ): Promise<LoginResult> => {
    const body: Record<string, string> = { email, password };
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
    if (data.requiresMfaCode) {
      await ensureCSRFToken(true);
      return { kind: "mfa-code", requiresMfaCode: true };
    }
    if (data.requiresMfaSetup) {
      await ensureCSRFToken(true);
      return { kind: "mfa-setup", requiresMfaSetup: true };
    }
    if (orgSlug) {
      try { localStorage.setItem("lastOrgSlug", orgSlug); } catch {}
    }
    queryClient.clear();
    setUser(data as User);
    await ensureCSRFToken(true);
    return { kind: "user", user: data as User };
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
