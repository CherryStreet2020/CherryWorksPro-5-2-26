import { QueryClient, QueryFunction } from "@tanstack/react-query";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

function showNetworkToast(message: string) {
  if (typeof window !== "undefined" && (window as any).__cherryToast) {
    (window as any).__cherryToast({ title: "Network Issue", description: message, variant: "destructive" });
  }
}

let _csrfToken: string | null = null;
let _csrfFetchPromise: Promise<void> | null = null;

export function storeCSRFToken(token: string) {
  _csrfToken = token;
}

function captureCSRFFromResponse(res: Response) {
  const token = res.headers.get("x-csrf-token");
  if (token) _csrfToken = token;
}

export function getCSRFToken(): string | null {
  return _csrfToken;
}

export function clearCSRFToken(): void {
  _csrfToken = null;
  _csrfFetchPromise = null;
}

async function fetchCSRFTokenFromServer(): Promise<void> {
  const res = await fetch("/api/csrf-token", { credentials: "include" });
  if (res.ok) {
    captureCSRFFromResponse(res);
    const data = await res.json();
    if (data.token) _csrfToken = data.token;
  }
}

export async function ensureCSRFToken(force = false): Promise<void> {
  if (_csrfToken && !force) return;
  if (_csrfFetchPromise) {
    await _csrfFetchPromise;
    if (_csrfToken && !force) return;
  }
  _csrfFetchPromise = fetchCSRFTokenFromServer()
    .catch((err) => {
      console.error("CSRF token fetch failed:", err);
    })
    .finally(() => {
      _csrfFetchPromise = null;
    });
  return _csrfFetchPromise;
}

async function doFetch(
  method: string,
  url: string,
  data?: unknown | undefined,
  signal?: AbortSignal,
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (data) headers["Content-Type"] = "application/json";
  const csrfToken = getCSRFToken();
  if (csrfToken && method !== "GET") headers["X-CSRF-Token"] = csrfToken;
  return fetch(url, {
    method,
    headers,
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
    signal,
  });
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
  options?: { signal?: AbortSignal },
): Promise<Response> {
  if (method !== "GET") {
    await ensureCSRFToken();
  }

  let res = await doFetch(method, url, data, options?.signal);
  captureCSRFFromResponse(res);

  if (res.status === 403 && method !== "GET") {
    const clone = res.clone();
    try {
      const body = await clone.json();
      if (body?.message === "Invalid CSRF token") {
        clearCSRFToken();
        await ensureCSRFToken(true);
        res = await doFetch(method, url, data, options?.signal);
        captureCSRFFromResponse(res);
      }
    } catch {}
  }

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    if (process.env.NODE_ENV !== "production") {
      const bad = queryKey.filter((seg) => seg === undefined || seg === null);
      if (bad.length > 0) {
        console.error(
          `[queryClient] queryKey contains ${bad.length} undefined/null segment(s):`,
          queryKey,
          "— this will produce an incorrect URL. Ensure the query is disabled (enabled: false) until all segments are defined."
        );
      }
    }
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    let res: Response;
    try {
      res = await fetch(queryKey.join("/") as string, {
        credentials: "include",
        signal: controller.signal,
      });
    } catch (err: any) {
      clearTimeout(timeoutId);
      if (err.name === "AbortError") {
        throw new Error("Request timed out after 30 seconds", { cause: err });
      }
      throw err;
    }
    clearTimeout(timeoutId);

    captureCSRFFromResponse(res);

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    if (res.status === 403) {
      try {
        const body = await res.clone().json();
        if (body?.requiredTier && body?.currentTier) {
          showNetworkToast(body.message || `This feature requires ${body.requiredTier} plan or higher.`);
          throw new Error(`403: ${body.message || "Tier gate"}`);
        }
      } catch (e: any) {
        if (e?.message?.startsWith("403:")) throw e;
      }
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
      retry: (failureCount, error) => {
        const msg = (error as Error)?.message || "";
        if (msg.startsWith("401:") || msg.startsWith("403:") || msg.startsWith("404:")) return false;
        if (msg.includes("Failed to fetch") || msg.includes("NetworkError")) {
          if (failureCount === 0) showNetworkToast("Network error — check your connection and try again");
          return failureCount < 2;
        }
        if (msg.startsWith("429:")) {
          if (failureCount === 0) showNetworkToast("You're doing that too fast. Please wait a moment and try again.");
          return false;
        }
        if (msg.startsWith("503:")) {
          if (failureCount === 0) showNetworkToast("CherryWorks Pro is temporarily unavailable. Please try again in a few minutes.");
          return failureCount < 2;
        }
        return failureCount < 2;
      },
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10000),
    },
    mutations: {
      retry: false,
      onError: (error) => {
        const msg = (error as Error)?.message || "";
        if (msg.includes("Failed to fetch") || msg.includes("NetworkError")) {
          showNetworkToast("Network error — check your connection and try again");
        } else if (msg.startsWith("429:")) {
          showNetworkToast("You're doing that too fast. Please wait a moment and try again.");
        } else if (msg.startsWith("503:")) {
          showNetworkToast("CherryWorks Pro is temporarily unavailable. Please try again in a few minutes.");
        }
      },
    },
  },
});
