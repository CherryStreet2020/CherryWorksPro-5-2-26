/**
 * Sprint M-Chat-1 — In-app loader for the universal marketing chatbot.
 * Injects /embed/chat.js with data-brand on mount. Idempotent via
 * window.__cwpMarketingChatLoaded. Marketing-only — never mount in the
 * authenticated shell.
 */
import { useEffect } from "react";
import { isMarketingOsEnabled } from "@/lib/featureFlags";

declare global {
  interface Window {
    __cwpMarketingChatLoaded?: boolean;
  }
}

const SCRIPT_ID = "cwp-marketing-chat-embed";

export function MarketingChatBubble({
  brandSlug = "cherryworks-pro",
}: {
  brandSlug?: string;
}) {
  useEffect(() => {
    if (!isMarketingOsEnabled()) return;
    if (typeof document === "undefined") return;

    // Idempotency: same flag the embed script sets, so a stray double
    // mount never injects two launchers.
    if (window.__cwpMarketingChatLoaded) return;
    if (document.getElementById(SCRIPT_ID)) return;

    const s = document.createElement("script");
    s.id = SCRIPT_ID;
    s.src = "/embed/chat.js";
    s.async = true;
    s.defer = true;
    s.setAttribute("data-brand", brandSlug);
    document.body.appendChild(s);

    // We intentionally do NOT remove the script on unmount. The bubble
    // sets up a fixed-position DOM element + listeners; tearing it down
    // mid-conversation would be jarring on SPA route changes.
  }, [brandSlug]);

  return null;
}
