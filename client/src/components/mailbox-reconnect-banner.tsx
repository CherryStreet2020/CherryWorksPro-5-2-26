import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { AlertTriangle, Mail, Copy } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";

interface EmailProviderStatus {
  providerType: "smtp" | "m365" | "google";
  isConnected: boolean;
  status?: "ok" | "needs_reconnect";
  failedSendCount?: number;
  lastErrorMessage?: string | null;
  lastErrorAt?: string | null;
}

interface MailboxReconnectBannerProps {
  withSettingsLink?: boolean;
  className?: string;
}

const ERROR_PREVIEW_THRESHOLD = 160;

/**
 * Shown to org admins when their connected Microsoft 365 / Gmail mailbox has
 * stopped working (token revoked, consent withdrawn, password changed, etc.).
 * Hidden for non-admins and for orgs whose mailbox is healthy.
 */
export function MailboxReconnectBanner({
  withSettingsLink = true,
  className = "",
}: MailboxReconnectBannerProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const isAdmin = user?.role === "ADMIN";
  const [detailsOpen, setDetailsOpen] = useState(false);

  const handleCopyError = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: "Error message copied" });
    } catch {
      toast({ title: "Could not copy", variant: "destructive" });
    }
  };

  const { data } = useQuery<EmailProviderStatus>({
    queryKey: ["/api/org/email-provider"],
    enabled: isAdmin,
  });

  if (!isAdmin) return null;
  if (!data || data.status !== "needs_reconnect") return null;
  if (data.providerType === "smtp") return null;

  const providerLabel = data.providerType === "m365" ? "Microsoft 365" : "Gmail";
  const failed = data.failedSendCount ?? 0;
  const errorMessage = (data.lastErrorMessage ?? "").trim();
  let failingSince: string | null = null;
  if (data.lastErrorAt) {
    const parsed = new Date(data.lastErrorAt);
    if (!Number.isNaN(parsed.getTime())) {
      failingSince = formatDistanceToNow(parsed, { addSuffix: true });
    }
  }
  const hasError = errorMessage.length > 0;
  const isLong = errorMessage.length > ERROR_PREVIEW_THRESHOLD;
  const previewText = isLong
    ? `${errorMessage.slice(0, ERROR_PREVIEW_THRESHOLD).trimEnd()}…`
    : errorMessage;

  return (
    <div
      className={`flex items-start gap-3 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100 ${className}`}
      data-testid="banner-mailbox-reconnect"
      role="alert"
    >
      <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" aria-hidden="true" />
      <div className="flex-1 min-w-0">
        <div className="font-semibold flex items-center gap-2">
          <Mail className="h-4 w-4" aria-hidden="true" />
          <span data-testid="text-mailbox-reconnect-title">
            {providerLabel} mailbox needs to be reconnected
          </span>
        </div>
        <p className="mt-1" data-testid="text-mailbox-reconnect-detail">
          {failed > 0
            ? `${failed} outgoing email${failed === 1 ? " has" : "s have"} failed`
            : "Outgoing emails are paused"}
          {failingSince ? (
            <>
              {" "}— started failing{" "}
              <span data-testid="text-mailbox-reconnect-since">{failingSince}</span>
            </>
          ) : null}
          . Invoice and password-reset emails will not be delivered until an
          admin reconnects the mailbox.
        </p>
        {hasError && (
          <div
            className="mt-2 rounded border border-amber-300/70 bg-amber-100/60 px-3 py-2 text-xs dark:border-amber-700/70 dark:bg-amber-900/40"
            data-testid="container-mailbox-reconnect-error"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="font-medium uppercase tracking-wide text-[11px] opacity-80">
                {providerLabel} reported
              </div>
              <button
                type="button"
                onClick={() => handleCopyError(errorMessage)}
                className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium underline-offset-2 hover:underline hover:text-amber-950 dark:hover:text-amber-50"
                data-testid="button-mailbox-reconnect-copy-error"
                aria-label="Copy error message"
              >
                <Copy className="h-3 w-3" aria-hidden="true" />
                Copy
              </button>
            </div>
            <p
              className="mt-1 whitespace-pre-wrap break-words font-mono text-[12px] leading-snug"
              data-testid="text-mailbox-reconnect-error"
            >
              {isLong && !detailsOpen ? previewText : errorMessage}
            </p>
            {isLong && (
              <button
                type="button"
                onClick={() => setDetailsOpen((v) => !v)}
                className="mt-1 font-medium underline underline-offset-2 hover:text-amber-950 dark:hover:text-amber-50"
                data-testid="button-mailbox-reconnect-toggle-details"
                aria-expanded={detailsOpen}
              >
                {detailsOpen ? "Hide details" : "Show details"}
              </button>
            )}
          </div>
        )}
        {withSettingsLink && (
          <Link
            href="/settings"
            className="mt-2 inline-block font-medium underline underline-offset-2 hover:text-amber-950 dark:hover:text-amber-50"
            data-testid="link-mailbox-reconnect-settings"
          >
            Reconnect in Settings →
          </Link>
        )}
      </div>
    </div>
  );
}
