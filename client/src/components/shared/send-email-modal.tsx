import { useState, useEffect, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/components/shared/format";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Send, X, Check, Plus, Paperclip } from "lucide-react";

interface SendEmailModalProps {
  open: boolean;
  onClose: () => void;
  /** `cc` is omitted only when the contacts failed to load and nobody edited the
   *  list — the server then CCs the billing contacts itself, as before. */
  onSend: (emailData: { to: string; cc?: string[]; subject: string; body: string }) => void;
  isPending: boolean;
  type: "invoice" | "estimate";
  number: string;
  clientName: string;
  clientEmail: string;
  orgName: string;
  total: string;
  dueDate?: string | null;
  expiryDate?: string | null;
  currency?: string;
  /** When provided, the client's contacts are fetched and offered as
   *  selectable recipient options for the To field. */
  clientId?: string;
  /** Resend mode (the document was already sent) — adjusts title/button copy. */
  isResend?: boolean;
}

/** Minimal shape of a client_contacts row used for recipient selection. */
export interface ContactLite {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  role: string | null;
  isPrimary: boolean;
  source?: string | null;
  billingAccess?: boolean | null;
  portalPendingAt?: string | null;
}

/** Mirrors server/email.ts isMoneyRecipient: Help Center self-registrations are support contacts, not billing ones. */
export function isMoneyRecipient(c: ContactLite): boolean {
  if (c.portalPendingAt) return false;
  if ((c.source || "").startsWith("help-center")) return !!c.isPrimary || !!c.billingAccess || (c.role || "").toLowerCase() === "billing";
  return true;
}

export interface RecipientOption {
  email: string;
  label: string;
}

export const CLIENT_EMAIL_LABEL = "Client email";

/** Build a deduped (case-insensitive by email) recipient list combining the
 *  primary client email with every contact that has an email. The client email
 *  is listed first (it remains the default To); a named contact label upgrades
 *  the generic "Client email" label when the addresses coincide. */
export function buildRecipientOptions(clientEmail: string, contacts: ContactLite[] | undefined): RecipientOption[] {
  const byEmail = new Map<string, RecipientOption>();
  const add = (rawEmail: string | null | undefined, label: string) => {
    const email = (rawEmail || "").trim();
    if (!email) return;
    const key = email.toLowerCase();
    const existing = byEmail.get(key);
    if (!existing) {
      byEmail.set(key, { email, label });
    } else if (existing.label === CLIENT_EMAIL_LABEL && label !== CLIENT_EMAIL_LABEL) {
      existing.label = label;
    }
  };
  add(clientEmail, CLIENT_EMAIL_LABEL);
  // Order to match the server's recipient precedence (server/email.ts pickRecipients):
  // primary → billing-role → everyone else. This keeps the modal's smart-default
  // (recipientOptions[0]) aligned with what the server would pick, so the auto-filled
  // To isn't an arbitrary non-billing contact. Array.sort is stable, so within a tier
  // the incoming order (primary desc, last name asc) is preserved.
  const ordered = [...(contacts || [])].filter(isMoneyRecipient).sort((a, b) => {
    const pa = a.isPrimary ? 0 : 1, pb = b.isPrimary ? 0 : 1;
    if (pa !== pb) return pa - pb;
    const ba = (a.role || "").toLowerCase() === "billing" ? 0 : 1;
    const bb = (b.role || "").toLowerCase() === "billing" ? 0 : 1;
    return ba - bb;
  });
  for (const c of ordered) {
    const name = `${c.firstName || ""} ${c.lastName || ""}`.trim();
    const role = c.role ? ` · ${c.role}` : "";
    add(c.email, (name || (c.email || "").trim()) + role);
  }
  return Array.from(byEmail.values());
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

function buildDefaultSubject(type: "invoice" | "estimate", number: string, orgName: string): string {
  if (type === "invoice") {
    return `Invoice #${number} from ${orgName}`;
  }
  return `Estimate #${number} from ${orgName}`;
}

function buildDefaultBody(props: {
  type: "invoice" | "estimate";
  clientName: string;
  number: string;
  total: string;
  currency: string;
  dueDate?: string | null;
  expiryDate?: string | null;
  orgName: string;
}): string {
  const { type, clientName, number, total, currency, dueDate, expiryDate, orgName } = props;
  const formattedTotal = formatMoney(total, currency || "USD");
  const firstName = clientName.split(" ")[0] || clientName;

  if (type === "invoice") {
    let body = `Dear ${firstName},\n\nPlease find attached Invoice #${number} for ${formattedTotal}.`;
    if (dueDate) {
      body += ` Payment is due by ${formatDate(dueDate)}.`;
    }
    body += `\n\nYou can view and pay this invoice online using the link provided.\n\nIf you have any questions regarding this invoice, please don't hesitate to reach out.\n\nThank you for your business.\n\nBest regards,\n${orgName}`;
    return body;
  }

  let body = `Dear ${firstName},\n\nPlease find attached Estimate #${number} for ${formattedTotal}.`;
  if (expiryDate) {
    body += ` This estimate is valid until ${formatDate(expiryDate)}.`;
  }
  body += `\n\nPlease review the details and let us know if you'd like to proceed or if you have any questions.\n\nWe look forward to working with you.\n\nBest regards,\n${orgName}`;
  return body;
}

// Same rule as the server (server/email.ts EMAIL_RE), so a contact the server
// would email (e.g. an IDN TLD like .xn--p1ai) is never dropped here.
const EMAIL_REGEX = /^[^\s@\r\n\f\v\0]+@[^\s@\r\n\f\v\0]+\.[^\s@\r\n\f\v\0]{2,}$/;

/** The CC the server adds when none is chosen (server/email.ts pickRecipients:
 *  billing-role contacts). Pre-selected so the dialog shows everyone who gets it. */
export function defaultCcEmails(contacts: ContactLite[] | undefined): string[] {
  return (contacts || [])
    .filter(isMoneyRecipient)
    .filter((c) => (c.role || "").toLowerCase() === "billing")
    .map((c) => (c.email || "").trim())
    .filter((e) => EMAIL_REGEX.test(e));
}

/** Append emails to a recipient list, deduped case-insensitively, first casing wins. */
export function addRecipients(list: string[], emails: string[]): string[] {
  const seen = new Set(list.map((e) => e.toLowerCase()));
  const out = [...list];
  for (const raw of emails) {
    const e = raw.trim();
    if (!e || seen.has(e.toLowerCase())) continue;
    seen.add(e.toLowerCase());
    out.push(e);
  }
  return out;
}

/** Split typed text ("a@x.com, b@y.com; c@z.com") into addresses. */
function splitTyped(text: string): string[] {
  return text.split(/[\s,;]+/).map((t) => t.trim()).filter(Boolean);
}

export function SendEmailModal({
  open,
  onClose,
  onSend,
  isPending,
  type,
  number,
  clientName,
  clientEmail,
  orgName,
  total,
  dueDate,
  expiryDate,
  currency = "USD",
  clientId,
  isResend = false,
}: SendEmailModalProps) {
  // Everyone who receives the email. The first is the To; the rest are CC'd.
  const [recipients, setRecipients] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [emailError, setEmailError] = useState("");

  // Always refetch on open: a cached list could be missing a contact added
  // since, and the defaults below must match who the server would email now.
  const { data: contacts, isError: contactsFailed, isFetching: contactsFetching } = useQuery<ContactLite[]>({
    queryKey: ["/api/clients", clientId, "contacts"],
    enabled: open && !!clientId,
    staleTime: 0,
  });

  const recipientOptions = useMemo(
    () => buildRecipientOptions(clientEmail, contacts),
    [clientEmail, contacts],
  );

  // Defaults follow the latest contact list until the user edits; any manual change wins.
  const touchedRef = useRef(false);
  const [edited, setEdited] = useState(false);
  const markEdited = () => { touchedRef.current = true; setEdited(true); };

  // Recipients reset only when the dialog opens or the client changes — not when
  // org settings or totals arrive late, which would drop the billing CCs.
  useEffect(() => {
    if (open) {
      const ce = (clientEmail || "").trim();
      setRecipients(ce ? [ce] : []);
      setDraft("");
      setEmailError("");
      touchedRef.current = false;
      setEdited(false);
    }
  }, [open, clientId, clientEmail]);

  useEffect(() => {
    if (open) {
      setSubject(buildDefaultSubject(type, number, orgName));
      setBody(buildDefaultBody({ type, clientName, number, total, currency, dueDate, expiryDate, orgName }));
    }
  }, [open, type, number, clientName, orgName, total, dueDate, expiryDate, currency]);

  // Smart default once contacts load: To = client email (else the first contact,
  // matching the server's precedence), CC = billing contacts — exactly who the
  // server would email if nothing were chosen, now visible and editable.
  useEffect(() => {
    if (!open || touchedRef.current || !contacts) return;
    const ce = (clientEmail || "").trim();
    const first = ce ? [ce] : recipientOptions.slice(0, 1).map((o) => o.email);
    setRecipients(addRecipients(first, defaultCcEmails(contacts)));
  }, [open, clientEmail, contacts, recipientOptions]);

  // Until the contact list has loaded, the default CCs aren't known yet; sending
  // then would send an explicit empty CC and skip the billing contacts.
  const contactsLoading = open && !!clientId && !contactsFailed && (contacts === undefined || contactsFetching);

  const isSelected = (email: string) => recipients.some((r) => r.toLowerCase() === email.toLowerCase());

  const toggle = (email: string) => {
    markEdited();
    setEmailError("");
    setRecipients((cur) =>
      cur.some((r) => r.toLowerCase() === email.toLowerCase())
        ? cur.filter((r) => r.toLowerCase() !== email.toLowerCase())
        : addRecipients(cur, [email]),
    );
  };

  /** Commit typed addresses; returns the merged list, or null when one is invalid. */
  const commitDraft = (): string[] | null => {
    const typed = splitTyped(draft);
    if (typed.length === 0) return recipients;
    const bad = typed.find((t) => !EMAIL_REGEX.test(t));
    if (bad) {
      setEmailError(`"${bad}" isn't a valid email address`);
      return null;
    }
    markEdited();
    const merged = addRecipients(recipients, typed);
    setRecipients(merged);
    setDraft("");
    setEmailError("");
    return merged;
  };

  const handleSend = () => {
    const list = commitDraft();
    if (!list) return;
    if (list.length === 0) {
      setEmailError("Add at least one recipient");
      return;
    }
    const bad = list.find((r) => !EMAIL_REGEX.test(r));
    if (bad) {
      setEmailError(`"${bad}" isn't a valid email address`);
      return;
    }
    const [to, ...cc] = list;
    onSend({ to, cc: contactsFailed && !edited ? undefined : cc, subject, body });
  };

  const typeLabel = type === "invoice" ? "Invoice" : "Estimate";
  const labelFor = (email: string) =>
    recipientOptions.find((o) => o.email.toLowerCase() === email.toLowerCase())?.label;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-xl max-h-[90vh] flex flex-col gap-0 overflow-hidden" style={{ background: "var(--lux-surface)", borderColor: "var(--lux-border)" }} data-testid="send-email-modal">
        <DialogHeader>
          <DialogTitle style={{ color: "var(--lux-text)" }}>{isResend ? "Resend" : "Send"} {typeLabel} #{number}</DialogTitle>
        </DialogHeader>
        {/* Body scrolls; the Cancel/Send row below stays on screen at any window height. */}
        <div className="space-y-4 pt-2 pb-1 flex-1 min-h-0 overflow-y-auto pr-1 -mr-1" data-testid="send-email-body">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium" style={{ color: "var(--lux-text-muted)" }}>To</Label>
            <div
              className="flex flex-wrap items-center gap-1.5 rounded-md border px-2 py-1.5 min-w-0"
              style={{ borderColor: emailError ? "#ef4444" : "var(--lux-border)", background: "var(--lux-bg)" }}
              data-testid="recipient-list"
            >
              {recipients.map((r, idx) => (
                <span
                  key={r.toLowerCase()}
                  className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs border min-w-0 max-w-full"
                  style={{ background: "var(--lux-surface)", color: "var(--lux-text)", borderColor: "var(--lux-border)" }}
                  title={r}
                  data-testid={`recipient-chip-${idx}`}
                >
                  <span className="text-[10px] font-semibold uppercase" style={{ color: "var(--lux-text-muted)" }}>{idx === 0 ? "To" : "Cc"}</span>
                  <span className="break-all">{labelFor(r) && labelFor(r) !== CLIENT_EMAIL_LABEL ? `${labelFor(r)!.split(" · ")[0]} <${r}>` : r}</span>
                  <button
                    type="button"
                    onClick={() => toggle(r)}
                    disabled={contactsLoading}
                    className="rounded-full p-0.5 hover:opacity-70 disabled:opacity-40"
                    aria-label={`Remove ${r}`}
                    data-testid={`button-remove-recipient-${idx}`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
              <input
                type="text"
                inputMode="email"
                value={draft}
                disabled={contactsLoading}
                onChange={(e) => { setDraft(e.target.value); if (emailError) setEmailError(""); }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === "," || e.key === ";") {
                    e.preventDefault();
                    commitDraft();
                  } else if (e.key === "Backspace" && !draft && recipients.length > 0) {
                    markEdited();
                    setRecipients((cur) => cur.slice(0, -1));
                  }
                }}
                onBlur={() => { if (draft.trim()) commitDraft(); }}
                placeholder={contactsLoading ? "Loading contacts…" : recipients.length === 0 ? "recipient@example.com" : "Add another email"}
                className="flex-1 min-w-[10rem] bg-transparent text-sm outline-none py-0.5"
                style={{ color: "var(--lux-text)" }}
                aria-label="Add recipient email"
                data-testid="input-email-to"
              />
            </div>
            {emailError && <p className="text-xs mt-1" style={{ color: "#ef4444" }} data-testid="text-email-error">{emailError}</p>}
            {recipients.length > 1 && (
              <p className="text-[11px]" style={{ color: "var(--lux-text-muted)" }}>
                The first recipient is the To; everyone else is CC'd.
              </p>
            )}
            {recipientOptions.length > 0 && (
              <div className="pt-1.5 space-y-1" data-testid="contact-options">
                <p className="text-[11px]" style={{ color: "var(--lux-text-muted)" }}>
                  Choose contacts from {clientName || "this company"} (select as many as you like):
                </p>
                <div className="flex flex-wrap gap-1.5 min-w-0 max-h-28 overflow-y-auto">
                  {recipientOptions.map((opt, idx) => {
                    const active = isSelected(opt.email);
                    return (
                      <button
                        key={opt.email}
                        type="button"
                        role="checkbox"
                        aria-checked={active}
                        onClick={() => toggle(opt.email)}
                        disabled={contactsLoading}
                        title={opt.email}
                        className={cn("inline-flex items-center gap-1.5 text-left rounded-md px-2.5 py-1 text-xs border transition-colors min-w-0 max-w-full")}
                        style={
                          active
                            ? { background: "var(--gradient-brand)", color: "#fff", borderColor: "transparent" }
                            : { background: "var(--lux-bg)", color: "var(--lux-text)", borderColor: "var(--lux-border)" }
                        }
                        data-testid={`button-contact-option-${idx}`}
                      >
                        {active ? <Check className="w-3 h-3 shrink-0" /> : <Plus className="w-3 h-3 shrink-0" />}
                        <span className="font-medium">{opt.label}</span>
                        {opt.label.toLowerCase() !== opt.email.toLowerCase() && (
                          <span className="break-all" style={{ color: active ? "rgba(255,255,255,0.85)" : "var(--lux-text-muted)" }}>{opt.email}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium" style={{ color: "var(--lux-text-muted)" }}>Subject</Label>
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Email subject"
              style={{ borderColor: "var(--lux-border)", color: "var(--lux-text)" }}
              data-testid="input-email-subject"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium" style={{ color: "var(--lux-text-muted)" }}>Message</Label>
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={6}
              className="text-sm font-sans leading-relaxed"
              style={{ borderColor: "var(--lux-border)", color: "var(--lux-text)" }}
              data-testid="input-email-body"
            />
          </div>
          {type === "invoice" && (
            <p className="flex items-center gap-1.5 text-xs" style={{ color: "var(--lux-text-muted)" }} data-testid="text-pdf-attached">
              <Paperclip className="w-3.5 h-3.5" /> Invoice-{number.replace(/[^A-Za-z0-9._-]+/g, "-")}.pdf will be attached
            </p>
          )}
          {contactsFailed && (
            <p className="text-xs" style={{ color: "var(--lux-text-muted)" }} data-testid="text-contacts-failed">
              {edited
                ? "Couldn't load this client's contacts. Only the addresses above will receive it, so add any billing contacts by hand."
                : "Couldn't load this client's contacts. Billing contacts will still be CC'd automatically."}
            </p>
          )}
        </div>
        <div className="flex justify-end gap-2 pt-3 mt-1 shrink-0 border-t" style={{ borderColor: "var(--lux-border)" }}>
          <Button variant="outline" onClick={onClose} disabled={isPending} style={{ borderColor: "var(--lux-border)", color: "var(--lux-text)" }} data-testid="button-cancel-send">
            <X className="w-4 h-4 mr-2" /> Cancel
          </Button>
          <Button
            onClick={handleSend}
            disabled={(recipients.length === 0 && !draft.trim()) || contactsLoading || isPending}
            style={{ background: "var(--gradient-brand)" }}
            className="text-white"
            data-testid="button-confirm-send"
          >
            <Send className="w-4 h-4 mr-2" /> {isPending ? "Sending..." : `${isResend ? "Resend" : "Send"} ${typeLabel}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
