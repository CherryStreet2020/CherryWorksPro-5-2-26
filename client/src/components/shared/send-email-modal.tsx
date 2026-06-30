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
import { Send, X } from "lucide-react";

interface SendEmailModalProps {
  open: boolean;
  onClose: () => void;
  onSend: (emailData: { to: string; subject: string; body: string }) => void;
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
  for (const c of contacts || []) {
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

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/;

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
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [emailError, setEmailError] = useState("");

  const { data: contacts } = useQuery<ContactLite[]>({
    queryKey: ["/api/clients", clientId, "contacts"],
    enabled: open && !!clientId,
  });

  const recipientOptions = useMemo(
    () => buildRecipientOptions(clientEmail, contacts),
    [clientEmail, contacts],
  );

  const autofilledRef = useRef(false);

  useEffect(() => {
    if (open) {
      setTo(clientEmail || "");
      setSubject(buildDefaultSubject(type, number, orgName));
      setBody(buildDefaultBody({ type, clientName, number, total, currency, dueDate, expiryDate, orgName }));
      setEmailError("");
      autofilledRef.current = false;
    }
  }, [open, type, number, clientName, clientEmail, orgName, total, dueDate, expiryDate, currency]);

  // Smart default: once the client's contacts load, if there is no client email
  // on file and the To is still blank, pre-address to the first resolved contact
  // (so a company with contacts but no top-level email isn't sent to nobody).
  useEffect(() => {
    if (open && !autofilledRef.current && !(clientEmail || "").trim() && !to.trim() && recipientOptions.length > 0) {
      setTo(recipientOptions[0].email);
      autofilledRef.current = true;
    }
  }, [open, clientEmail, to, recipientOptions]);

  const handleSend = () => {
    if (!EMAIL_REGEX.test(to.trim())) {
      setEmailError("Please enter a valid email address");
      return;
    }
    setEmailError("");
    onSend({ to: to.trim(), subject, body });
  };

  const typeLabel = type === "invoice" ? "Invoice" : "Estimate";

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-xl" style={{ background: "var(--lux-surface)", borderColor: "var(--lux-border)" }} data-testid="send-email-modal">
        <DialogHeader>
          <DialogTitle style={{ color: "var(--lux-text)" }}>{isResend ? "Resend" : "Send"} {typeLabel} #{number}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium" style={{ color: "var(--lux-text-muted)" }}>To</Label>
            <Input
              type="email"
              value={to}
              onChange={(e) => { setTo(e.target.value); if (emailError) setEmailError(""); }}
              placeholder="recipient@example.com"
              style={{ borderColor: emailError ? "#ef4444" : "var(--lux-border)", color: "var(--lux-text)" }}
              data-testid="input-email-to"
            />
            {emailError && <p className="text-xs mt-1" style={{ color: "#ef4444" }} data-testid="text-email-error">{emailError}</p>}
            {(() => {
              const currentTo = to.trim().toLowerCase();
              const showPicker =
                recipientOptions.length > 1 ||
                (recipientOptions.length === 1 && recipientOptions[0].email.toLowerCase() !== currentTo);
              if (!showPicker) return null;
              return (
                <div className="pt-1.5 space-y-1" data-testid="contact-options">
                  <p className="text-[11px]" style={{ color: "var(--lux-text-muted)" }}>
                    Select a contact from {clientName || "this company"}:
                  </p>
                  <div className="flex flex-wrap gap-1.5 min-w-0">
                    {recipientOptions.map((opt, idx) => {
                      const active = currentTo === opt.email.toLowerCase();
                      return (
                        <button
                          key={opt.email}
                          type="button"
                          onClick={() => { setTo(opt.email); if (emailError) setEmailError(""); }}
                          title={opt.email}
                          className={cn("text-left rounded-md px-2.5 py-1 text-xs border transition-colors min-w-0 max-w-full")}
                          style={
                            active
                              ? { background: "var(--gradient-brand)", color: "#fff", borderColor: "transparent" }
                              : { background: "var(--lux-bg)", color: "var(--lux-text)", borderColor: "var(--lux-border)" }
                          }
                          data-testid={`button-contact-option-${idx}`}
                        >
                          <span className="font-medium">{opt.label}</span>
                          {opt.label.toLowerCase() !== opt.email.toLowerCase() && (
                            <span className="ml-1.5 break-all" style={{ color: active ? "rgba(255,255,255,0.85)" : "var(--lux-text-muted)" }}>{opt.email}</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })()}
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
              rows={10}
              className="text-sm font-sans leading-relaxed"
              style={{ borderColor: "var(--lux-border)", color: "var(--lux-text)" }}
              data-testid="input-email-body"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose} disabled={isPending} style={{ borderColor: "var(--lux-border)", color: "var(--lux-text)" }} data-testid="button-cancel-send">
              <X className="w-4 h-4 mr-2" /> Cancel
            </Button>
            <Button
              onClick={handleSend}
              disabled={!to || isPending}
              style={{ background: "var(--gradient-brand)" }}
              className="text-white"
              data-testid="button-confirm-send"
            >
              <Send className="w-4 h-4 mr-2" /> {isPending ? "Sending..." : `${isResend ? "Resend" : "Send"} ${typeLabel}`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
