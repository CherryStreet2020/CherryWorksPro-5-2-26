import { createContext, useContext, useState, useEffect, useRef, useCallback } from "react";
import { AlertTriangle, Wifi, WifiOff, X as XIcon } from "lucide-react";

interface NetworkState {
  isOnline: boolean;
  isServerReachable: boolean;
}

const NetworkContext = createContext<NetworkState>({ isOnline: true, isServerReachable: true });

export function useNetworkStatus() {
  return useContext(NetworkContext);
}

export function NetworkStatusProvider({ children }: { children: React.ReactNode }) {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [isServerReachable, setIsServerReachable] = useState(true);
  const [showRestoredBanner, setShowRestoredBanner] = useState(false);
  const wasOfflineRef = useRef(false);
  const restoredTimerRef = useRef<ReturnType<typeof setTimeout>>();

  const checkServer = useCallback(async () => {
    if (!navigator.onLine) {
      setIsServerReachable(false);
      return;
    }
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const res = await fetch("/api/health", { signal: controller.signal, credentials: "include" });
      clearTimeout(timeout);
      setIsServerReachable(res.ok);
    } catch {
      setIsServerReachable(false);
    }
  }, []);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      checkServer();
    };
    const handleOffline = () => {
      setIsOnline(false);
      setIsServerReachable(false);
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    checkServer();
    const interval = setInterval(checkServer, 30000);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      clearInterval(interval);
    };
  }, [checkServer]);

  useEffect(() => {
    const currentlyDown = !isOnline || !isServerReachable;
    if (currentlyDown) {
      wasOfflineRef.current = true;
    } else if (wasOfflineRef.current) {
      wasOfflineRef.current = false;
      setShowRestoredBanner(true);
      if (restoredTimerRef.current) clearTimeout(restoredTimerRef.current);
      restoredTimerRef.current = setTimeout(() => setShowRestoredBanner(false), 3000);
    }
  }, [isOnline, isServerReachable]);

  useEffect(() => {
    return () => {
      if (restoredTimerRef.current) clearTimeout(restoredTimerRef.current);
    };
  }, []);

  return (
    <NetworkContext.Provider value={{ isOnline, isServerReachable }}>
      {!isOnline && (
        <div
          className="flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium"
          style={{ background: "#fef3c7", borderBottom: "1px solid #fcd34d", color: "#92400e", zIndex: 9999, position: "relative" }}
          data-testid="banner-offline"
        >
          <WifiOff className="w-4 h-4 flex-shrink-0" />
          <span>You're offline. Changes won't be saved until your connection is restored.</span>
        </div>
      )}
      {isOnline && !isServerReachable && (
        <div
          className="flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium"
          style={{ background: "#fef3c7", borderBottom: "1px solid #fcd34d", color: "#92400e", zIndex: 9999, position: "relative" }}
          data-testid="banner-server-unreachable"
        >
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span>Unable to reach CherryWorks Pro servers. Retrying...</span>
        </div>
      )}
      {showRestoredBanner && isOnline && isServerReachable && (
        <div
          className="flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium"
          style={{ background: "#d1fae5", borderBottom: "1px solid #6ee7b7", color: "#065f46", zIndex: 9999, position: "relative" }}
          data-testid="banner-back-online"
        >
          <Wifi className="w-4 h-4 flex-shrink-0" />
          <span>You're back online</span>
        </div>
      )}
      {children}
    </NetworkContext.Provider>
  );
}
