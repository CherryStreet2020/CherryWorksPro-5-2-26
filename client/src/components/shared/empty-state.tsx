import { Button } from "@/components/ui/button";
import type { LucideIcon } from "lucide-react";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: () => void;
  actionLabel?: string;
}

export function EmptyState({ icon: Icon, title, description, action, actionLabel }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4" data-testid="empty-state">
      <div className="mb-4" style={{ opacity: 0.4 }}>
        <Icon size={48} style={{ color: "var(--lux-text-muted)" }} />
      </div>
      <h3 className="text-lg font-semibold mb-1" style={{ color: "var(--lux-text)" }}>
        {title}
      </h3>
      <p className="text-sm text-center max-w-sm mb-6" style={{ color: "var(--lux-text-muted)" }}>
        {description}
      </p>
      {action && actionLabel && (
        <Button onClick={action} data-testid="button-empty-action">
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
