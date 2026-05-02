import { useState, useEffect } from "react";
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
}: SendEmailModalProps) {
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [emailError, setEmailError] = useState("");

  useEffect(() => {
    if (open) {
      setTo(clientEmail || "");
      setSubject(buildDefaultSubject(type, number, orgName));
      setBody(buildDefaultBody({ type, clientName, number, total, currency, dueDate, expiryDate, orgName }));
      setEmailError("");
    }
  }, [open, type, number, clientName, clientEmail, orgName, total, dueDate, expiryDate, currency]);

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
          <DialogTitle style={{ color: "var(--lux-text)" }}>Send {typeLabel} #{number}</DialogTitle>
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
              <Send className="w-4 h-4 mr-2" /> {isPending ? "Sending..." : `Send ${typeLabel}`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
