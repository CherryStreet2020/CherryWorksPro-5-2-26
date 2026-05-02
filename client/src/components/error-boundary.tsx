import { Component, type ReactNode } from "react";
import { RefreshCw, Home, Mail } from "lucide-react";
import { BrandLockup } from "@/components/shared/brand-lockup";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[ErrorBoundary] Caught error:", error, info);
    const msg = error?.message || "";
    const isChunkError =
      msg.includes("Failed to fetch dynamically imported module") ||
      msg.includes("Loading chunk") ||
      msg.includes("Loading CSS chunk") ||
      msg.includes("Importing a module script failed") ||
      msg.includes("error loading dynamically imported module");
    if (isChunkError) {
      const key = "eb_chunk_reload";
      if (!sessionStorage.getItem(key)) {
        sessionStorage.setItem(key, "1");
        window.location.reload();
        return;
      }
      sessionStorage.removeItem(key);
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center p-6" style={{ background: "var(--lux-bg, #0f0f0f)" }}>
          <div className="max-w-md w-full text-center space-y-8">
            <div className="flex justify-center">
              <BrandLockup iconSize={48} textSize="lg" />
            </div>

            <div className="space-y-3">
              <h1
                className="text-5xl font-bold tracking-tight"
                style={{ color: "var(--lux-text, #fff)" }}
                data-testid="text-error-title"
              >
                Something Went Wrong
              </h1>
              <p className="text-base leading-relaxed" style={{ color: "var(--lux-text-muted, #888)" }}>
                An unexpected error occurred — our team has been notified.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <button
                onClick={() => window.location.reload()}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white rounded-lg transition-opacity hover:opacity-90"
                style={{ background: "var(--gradient-brand, #dc2626)" }}
                data-testid="button-reload"
              >
                <RefreshCw className="w-4 h-4" />
                Reload Page
              </button>
              <button
                onClick={() => { window.location.href = "/dashboard"; }}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg transition-opacity hover:opacity-80"
                style={{
                  color: "var(--lux-accent, #dc2626)",
                  background: "rgba(var(--lux-accent-rgb, 220,38,38),0.08)",
                  border: "1px solid rgba(var(--lux-accent-rgb, 220,38,38),0.2)",
                }}
                data-testid="link-back-to-dashboard"
              >
                <Home className="w-4 h-4" />
                Back to Dashboard
              </button>
              <a
                href="mailto:support@cherryworkspro.com"
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg transition-opacity hover:opacity-80"
                style={{ color: "var(--lux-text-muted, #888)" }}
                data-testid="link-contact-support"
              >
                <Mail className="w-4 h-4" />
                Contact Support
              </a>
            </div>

            {process.env.NODE_ENV !== "production" && this.state.error && (
              <details className="text-left mt-4 p-3 rounded-lg text-xs" style={{ background: "var(--lux-surface-alt, #1a1a1a)", color: "var(--lux-text-muted, #888)" }}>
                <summary className="cursor-pointer font-medium mb-2">Error Details</summary>
                <pre className="whitespace-pre-wrap break-words">{this.state.error.message}</pre>
                <pre className="whitespace-pre-wrap break-words mt-2 opacity-60">{this.state.error.stack}</pre>
              </details>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
