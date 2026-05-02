import { Link } from "wouter";
import { Home, Mail } from "lucide-react";
import { CherryLogo } from "@/components/shared/cherry-logo";

export default function NotFound() {
  return (
    <div className="min-h-[80vh] flex items-center justify-center p-6" style={{ background: "var(--lux-bg)" }}>
      <div className="max-w-md w-full text-center space-y-8">
        <div
          className="relative mx-auto w-32 h-32 rounded-3xl flex items-center justify-center"
          style={{
            background: "linear-gradient(135deg, rgba(var(--lux-accent-rgb),0.12) 0%, rgba(var(--lux-accent-rgb),0.04) 100%)",
            border: "1px solid var(--lux-border)",
            boxShadow: "var(--lux-card-shadow)",
          }}
        >
          <CherryLogo size={56} />
          <div
            className="absolute -top-2 -right-2 w-10 h-10 rounded-full flex items-center justify-center text-white text-xs font-bold"
            style={{ background: "var(--gradient-brand)" }}
          >
            404
          </div>
        </div>

        <div className="space-y-3">
          <h1
            className="text-5xl font-bold tracking-tight"
            style={{ color: "var(--lux-text)" }}
            data-testid="text-error-title"
          >
            Page Not Found
          </h1>
          <p className="text-base leading-relaxed" style={{ color: "var(--lux-text-muted)" }}>
            The page you're looking for doesn't exist or has been moved.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <Link href="/dashboard">
            <span
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white rounded-lg cursor-pointer transition-all hover:opacity-90"
              style={{ background: "var(--gradient-brand)" }}
              data-testid="link-back-to-dashboard"
            >
              <Home className="w-4 h-4" />
              Back to Dashboard
            </span>
          </Link>
          <a
            href="mailto:support@cherryworkspro.com"
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg cursor-pointer transition-all hover:opacity-80"
            style={{
              color: "var(--lux-accent)",
              background: "rgba(var(--lux-accent-rgb),0.08)",
              border: "1px solid rgba(var(--lux-accent-rgb),0.2)",
            }}
            data-testid="link-contact-support"
          >
            <Mail className="w-4 h-4" />
            Contact Support
          </a>
        </div>
      </div>
    </div>
  );
}
