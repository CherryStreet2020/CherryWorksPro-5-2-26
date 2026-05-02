import { Button } from "@/components/ui/button";
import { AlertCircle, RefreshCw, Home, WifiOff } from "lucide-react";
import { useLocation } from "wouter";

interface FetchErrorProps {
  message?: string;
  onRetry?: () => void;
  isNetworkError?: boolean;
}

export function FetchError({ message, onRetry, isNetworkError }: FetchErrorProps) {
  const [, navigate] = useLocation();

  const isNetwork = isNetworkError || message?.toLowerCase().includes("failed to fetch") || message?.toLowerCase().includes("network");
  const Icon = isNetwork ? WifiOff : AlertCircle;
  const title = isNetwork ? "Connection Problem" : "Something went wrong";
  const description = isNetwork
    ? "Check your internet connection and try again"
    : message || "Something went wrong loading this page";

  return (
    <div className="flex flex-col items-center justify-center py-16 px-4" data-testid="fetch-error">
      <div className="mb-4" style={{ opacity: 0.4 }}>
        <Icon size={48} style={{ color: "var(--lux-text-muted)" }} />
      </div>
      <h3 className="text-lg font-semibold mb-1" style={{ color: "var(--lux-text)" }}>
        {title}
      </h3>
      <p className="text-sm text-center max-w-sm mb-6" style={{ color: "var(--lux-text-muted)" }}>
        {description}
      </p>
      <div className="flex items-center gap-3">
        {onRetry && (
          <Button onClick={onRetry} data-testid="button-fetch-retry">
            <RefreshCw className="w-4 h-4 mr-2" />
            Try Again
          </Button>
        )}
        <Button variant="outline" onClick={() => navigate("/")} data-testid="button-fetch-go-dashboard">
          <Home className="w-4 h-4 mr-2" />
          Go to Dashboard
        </Button>
      </div>
    </div>
  );
}
