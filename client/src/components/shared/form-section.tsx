interface FormSectionProps {
  title: string;
  description?: string;
  action?: React.ReactNode;
  icon?: React.ReactNode;
  children: React.ReactNode;
}

export function FormSection({ title, description, action, icon, children }: FormSectionProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        {icon && <span style={{ color: "var(--lux-text-muted)" }}>{icon}</span>}
        <h3 className="text-sm font-semibold whitespace-nowrap" style={{ color: "var(--lux-text)" }}>
          {title}
        </h3>
        <div className="flex-1 h-px" style={{ background: "var(--lux-border)" }} />
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {description && (
        <p className="text-xs" style={{ color: "var(--lux-text-muted)" }}>
          {description}
        </p>
      )}
      <div>{children}</div>
    </div>
  );
}
