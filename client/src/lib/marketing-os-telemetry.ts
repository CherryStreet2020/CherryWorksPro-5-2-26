/**
 * Task 147 — client helper for Marketing OS discovery telemetry.
 *
 * Posts to /api/telemetry/marketing-os. Fire-and-forget: telemetry must
 * never block UI or surface errors to the user.
 */
import { apiRequest } from "@/lib/queryClient";

export type MarketingOsTelemetryEvent =
  | "marketing_os.discovery.section_shown"
  | "marketing_os.discovery.modal_opened"
  | "marketing_os.discovery.checkout_clicked";

export function trackMarketingOsEvent(
  event: MarketingOsTelemetryEvent,
  props?: Record<string, unknown>,
): void {
  try {
    void apiRequest("POST", "/api/telemetry/marketing-os", {
      event,
      props: props ?? {},
    }).catch(() => {
      /* swallow — telemetry must not break UX */
    });
  } catch {
    /* swallow */
  }
}

const SESSION_SHOWN_KEY = "marketing_os.discovery.section_shown.fired";

/**
 * Fires `section_shown` at most once per browser session.
 * Uses sessionStorage so it resets on tab close / new login.
 */
export function trackSectionShownOncePerSession(): void {
  try {
    if (typeof window === "undefined") return;
    if (window.sessionStorage.getItem(SESSION_SHOWN_KEY) === "1") return;
    window.sessionStorage.setItem(SESSION_SHOWN_KEY, "1");
  } catch {
    // sessionStorage may be unavailable (private mode); fall through and fire.
  }
  trackMarketingOsEvent("marketing_os.discovery.section_shown");
}
