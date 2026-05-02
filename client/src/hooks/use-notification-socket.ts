import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";

interface Options {
  enabled?: boolean;
}

export function useNotificationSocket({ enabled = true }: Options = {}) {
  const queryClient = useQueryClient();
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const closedByUserRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    closedByUserRef.current = false;

    const invalidate = () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] });
    };

    const connect = () => {
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      const url = `${proto}//${window.location.host}/ws/notifications`;
      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch {
        scheduleReconnect();
        return;
      }
      wsRef.current = ws;

      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data);
          if (msg && typeof msg.event === "string" && msg.event !== "connected") {
            invalidate();
          }
        } catch {
          invalidate();
        }
      };

      ws.onclose = () => {
        wsRef.current = null;
        if (!closedByUserRef.current) scheduleReconnect();
      };

      ws.onerror = () => {
        try { ws.close(); } catch { /* ignore */ }
      };
    };

    const scheduleReconnect = () => {
      if (reconnectTimerRef.current != null) return;
      reconnectTimerRef.current = window.setTimeout(() => {
        reconnectTimerRef.current = null;
        if (!closedByUserRef.current) connect();
      }, 5000);
    };

    connect();

    return () => {
      closedByUserRef.current = true;
      if (reconnectTimerRef.current != null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (wsRef.current) {
        try { wsRef.current.close(); } catch { /* ignore */ }
        wsRef.current = null;
      }
    };
  }, [enabled, queryClient]);
}
