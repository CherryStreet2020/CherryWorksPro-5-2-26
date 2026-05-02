import { HelpCircle } from "lucide-react";
import { openHelpPanel } from "@/lib/help-context";

export function PageHelpLink({ label }: { label?: string }) {
  return (
    <button
      onClick={openHelpPanel}
      className="inline-flex items-center gap-1.5 text-xs font-medium cursor-pointer transition-all hover:opacity-80"
      style={{ color: "var(--lux-text-muted)" }}
      data-testid="button-page-help"
    >
      <HelpCircle className="w-3.5 h-3.5" />
      {label || "Need help?"}
    </button>
  );
}
