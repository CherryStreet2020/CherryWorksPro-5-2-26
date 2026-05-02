const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  DRAFT:      { label: "Draft",      color: "var(--lux-text-muted)",  bg: "rgba(148,163,184,0.12)" },
  SENT:       { label: "Sent",       color: "#d97706",                bg: "rgba(217,119,6,0.1)" },
  PARTIAL:    { label: "Partial",    color: "#d97706",                bg: "rgba(217,119,6,0.1)" },
  PAID:       { label: "Paid",       color: "#16a34a",                bg: "rgba(22,163,74,0.1)" },
  VOID:       { label: "Void",       color: "#ef4444",                bg: "rgba(239,68,68,0.12)" },
  OVERDUE:    { label: "Overdue",    color: "#dc2626",                bg: "rgba(220,38,38,0.1)" },
  ACTIVE:     { label: "Active",     color: "#15803d",                bg: "rgba(21,128,61,0.1)" },
  COMPLETED:  { label: "Completed",  color: "#2563eb",                bg: "rgba(37,99,235,0.1)" },
  ON_HOLD:    { label: "On Hold",    color: "#d97706",                bg: "rgba(217,119,6,0.1)" },
  ARCHIVED:   { label: "Archived",   color: "var(--lux-text-muted)",  bg: "rgba(148,163,184,0.12)" },
  SUBMITTED:  { label: "Submitted",  color: "#2563eb",                bg: "rgba(37,99,235,0.1)" },
  APPROVED:   { label: "Approved",   color: "#15803d",                bg: "rgba(21,128,61,0.1)" },
  REJECTED:   { label: "Rejected",   color: "#dc2626",                bg: "rgba(220,38,38,0.1)" },
  ACCEPTED:   { label: "Accepted",   color: "#15803d",                bg: "rgba(21,128,61,0.1)" },
  DECLINED:   { label: "Declined",   color: "#dc2626",                bg: "rgba(220,38,38,0.1)" },
  EXPIRED:    { label: "Expired",    color: "var(--lux-text-muted)",  bg: "rgba(148,163,184,0.12)" },
  INVOICED:   { label: "Invoiced",  color: "#059669",                bg: "rgba(5,150,105,0.1)" },
  BILLED:     { label: "Billed",     color: "#15803d",                bg: "rgba(21,128,61,0.1)" },
  UNBILLED:   { label: "Unbilled",   color: "var(--lux-text-muted)",  bg: "rgba(148,163,184,0.08)" },
  CHECK:      { label: "Check",      color: "#7c3aed",                bg: "rgba(124,58,237,0.1)" },
  WIRE:       { label: "Wire",       color: "#4f46e5",                bg: "rgba(79,70,229,0.1)" },
  ACH:        { label: "ACH",        color: "#0284c7",                bg: "rgba(2,132,199,0.1)" },
  STRIPE:     { label: "Stripe",     color: "#4f46e5",                bg: "rgba(79,70,229,0.1)" },
  MANUAL:     { label: "Manual",     color: "var(--lux-text-muted)",  bg: "rgba(148,163,184,0.12)" },
  CASH:       { label: "Cash",       color: "#15803d",                bg: "rgba(21,128,61,0.1)" },
  OTHER:      { label: "Other",      color: "var(--lux-text-muted)",  bg: "rgba(148,163,184,0.12)" },
  LOCKED:     { label: "Locked",     color: "#d97706",                bg: "rgba(217,119,6,0.1)" },
  PENDING:    { label: "Pending",    color: "#d97706",                bg: "rgba(217,119,6,0.1)" },
  ADMIN:      { label: "Admin",     color: "#7c3aed",                bg: "rgba(124,58,237,0.1)" },
  MANAGER:    { label: "Manager",   color: "#2563eb",                bg: "rgba(37,99,235,0.1)" },
  TEAM_MEMBER: { label: "Team Member", color: "#0891b2",               bg: "rgba(8,145,178,0.1)" },
};

interface StatusBadgeProps {
  status: string;
  size?: "xs" | "sm";
}

export function StatusBadge({ status, size = "sm" }: StatusBadgeProps) {
  const config = STATUS_CONFIG[status] || {
    label: status,
    color: "var(--lux-text-muted)",
    bg: "rgba(148,163,184,0.10)",
  };

  const sizeClasses = size === "xs"
    ? "text-[10px] px-2 py-0.5"
    : "text-[11px] px-2.5 py-0.5";

  return (
    <span
      data-testid={`badge-status-${status.toLowerCase()}`}
      className={`inline-flex items-center font-semibold rounded-full whitespace-nowrap ${sizeClasses}`}
      style={{ color: config.color, backgroundColor: config.bg }}
    >
      {config.label}
    </span>
  );
}
