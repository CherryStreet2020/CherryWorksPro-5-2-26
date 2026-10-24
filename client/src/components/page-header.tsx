import { PageHelpLink } from "@/components/page-help-link";

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between" data-testid="page-header">
      <div className="flex items-center gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight" style={{ color: "var(--lux-text)" }} data-testid="text-page-title">{title}</h1>
            <PageHelpLink />
          </div>
          {subtitle && <p className="text-sm mt-0.5" style={{ color: "var(--lux-text-muted)" }} data-testid="text-page-subtitle">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  );
}
