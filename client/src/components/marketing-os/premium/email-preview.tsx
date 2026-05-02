/**
 * EmailPreview — Sprint 2m premium primitive.
 *
 * Realistic email card (From, Subject, body, signature, primary CTA)
 * for live preview inside email composer dialogs.
 *
 * Theme behaviour: Container uses `--lux-surface-alt` so it adapts to
 * the app theme. The email card itself is intentionally white in BOTH
 * themes — emails render on white in real inboxes. The primary CTA
 * uses `--lux-accent`. No interactive controls inside (presentational
 * only); any wrapping focusable element should follow the project
 * focus-ring rule (`box-shadow: 0 0 0 2px rgba(var(--lux-accent-rgb),
 * 0.25)` directly on `:focus-visible`, never `var(--lux-focus-ring)`).
 */
import * as React from "react";
import { cn } from "@/lib/utils";

export interface EmailPreviewProps {
  /** Brand accent color for the CTA. Defaults to `--lux-accent` token. */
  primaryColor?: string;
  fromName?: string;
  fromEmail?: string;
  subject?: string;
  body?: React.ReactNode;
  ctaLabel?: string;
  signatureName?: string;
  signatureTitle?: string;
  className?: string;
}

export function EmailPreview({
  primaryColor,
  fromName = "Mira from CherryWorks",
  fromEmail = "mira@cherryworks.app",
  subject = "Quick check-in 👋",
  body = "Just wanted to follow up on our last conversation — let me know if there's a good time this week to chat.",
  ctaLabel = "Book a 15-min call",
  signatureName = "Mira Patel",
  signatureTitle = "Customer Success",
  className,
}: EmailPreviewProps) {
  return (
    <div
      data-testid="premium-email-preview"
      className={cn(
        "rounded-xl border p-4",
        className,
      )}
      style={{
        background: "var(--lux-surface-alt)",
        borderColor: "var(--lux-border)",
      }}
    >
      <div
        className="rounded-lg border bg-white p-5 text-[#1a1a2e] shadow-sm"
        style={{ borderColor: "rgba(0,0,0,0.08)" }}
      >
        <div className="border-b pb-3" style={{ borderColor: "rgba(0,0,0,0.06)" }}>
          <div className="text-xs text-neutral-500">
            From <span className="font-medium text-neutral-800">{fromName}</span>{" "}
            &lt;{fromEmail}&gt;
          </div>
          <div className="mt-1 text-sm font-semibold">{subject}</div>
        </div>
        <div className="space-y-3 pt-3 text-sm leading-relaxed">
          <p>Hi there,</p>
          <p>{body}</p>
          <div>
            <a
              href="#"
              onClick={(e) => e.preventDefault()}
              className="inline-flex items-center rounded-md px-4 py-2 text-sm font-medium text-white focus-visible:outline-none focus-visible:shadow-[0_0_0_2px_rgba(var(--lux-accent-rgb),0.25)]"
              style={{ background: primaryColor || "var(--lux-accent)" }}
            >
              {ctaLabel}
            </a>
          </div>
          <div className="pt-2 text-xs text-neutral-500">
            <div className="font-medium text-neutral-800">{signatureName}</div>
            <div>{signatureTitle}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default EmailPreview;
