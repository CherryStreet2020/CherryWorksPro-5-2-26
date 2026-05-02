import { AlertTriangle, RefreshCw, WifiOff, Home } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";

interface ErrorStateProps {
  title?: string;
  description?: string;
  onRetry?: () => void;
  error?: Error | null;
  showDashboardLink?: boolean;
}

export function ErrorState({
  title,
  description,
  onRetry,
  error,
  showDashboardLink = false,
}: ErrorStateProps) {
  const [, navigate] = useLocation();
  const isNetwork = error?.message?.toLowerCase().includes("failed to fetch") ||
    error?.message?.toLowerCase().includes("network") ||
    !navigator.onLine;

  const displayTitle = title || (isNetwork ? "Connection Problem" : "Something went wrong");
  const displayDesc = description || (isNetwork
    ? "Check your internet connection and try again"
    : "We couldn't load this data. Please try again.");
  const Icon = isNetwork ? WifiOff : AlertTriangle;

  return (
    <div className="flex flex-col items-center justify-center py-16 px-4" data-testid="error-state" role="alert">
      <div className="mb-4" style={{ opacity: 0.6 }}>
        <Icon size={48} style={{ color: "var(--lux-text-muted)" }} aria-hidden="true" />
      </div>
      <h3 className="text-lg font-semibold mb-1" style={{ color: "var(--lux-text)" }}>
        {displayTitle}
      </h3>
      <p className="text-sm text-center max-w-sm mb-6" style={{ color: "var(--lux-text-muted)" }}>
        {displayDesc}
      </p>
      <div className="flex items-center gap-3">
        {onRetry && (
          <Button onClick={onRetry} variant="outline" data-testid="button-retry">
            <RefreshCw className="w-4 h-4 mr-2" aria-hidden="true" />
            Try Again
          </Button>
        )}
        {showDashboardLink && (
          <Button variant="ghost" onClick={() => navigate("/")} data-testid="button-go-dashboard">
            <Home className="w-4 h-4 mr-2" />
            Go to Dashboard
          </Button>
        )}
      </div>
    </div>
  );
}
