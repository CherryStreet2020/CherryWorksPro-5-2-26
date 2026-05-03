import { createContext, useContext, useState, useEffect, useCallback } from "react";
import type { User } from "@shared/schema";
import { apiRequest, queryClient, ensureCSRFToken } from "./queryClient";

// Discriminated union of every shape /api/auth/login can return when the
// request itself is HTTP 200. Errors (bad credentials, needsOrgPick) are
// thrown by `login()` and are NOT part of this type.
//   - mfa-code:  user has an enabled enrollment, must POST /api/mfa/totp/validate.
//   - mfa-setup: org enforces MFA but user has no enrollment yet; must POST
//                /api/mfa/totp/setup then /api/mfa/totp/verify.
//   - user:      fully authenticated; the User payload is set on AuthContext.
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
    // MFA flows: server returns {requiresMfaSetup} or {requiresMfaCode} and
    // leaves the session in mfaPending state. Surface to the caller so the
    // login page can render the TOTP challenge UI without setting `user`.
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
