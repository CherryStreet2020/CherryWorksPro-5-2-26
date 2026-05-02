import { PageHelpLink } from "@/components/page-help-link";
import { type LucideIcon } from "lucide-react";

export function PageHeader({
  title,
  subtitle,
  actions,
  icon: Icon,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  icon?: LucideIcon;
}) {
  return (
    <div className="flex items-center justify-between" data-testid="page-header">
      <div className="flex items-center gap-4">
        {Icon && (
          <div className="relative">
            <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: "linear-gradient(135deg, rgba(var(--lux-accent-rgb),0.15) 0%, rgba(var(--lux-accent-rgb),0.05) 100%)" }}>
              <Icon className="w-6 h-6" style={{ color: "var(--lux-accent)" }} />
            </div>
          </div>
        )}
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
