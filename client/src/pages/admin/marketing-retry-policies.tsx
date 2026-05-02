import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Shield, ShieldOff, Gauge } from "lucide-react";

interface OperatorProbe {
  isPlatformOperator: boolean;
}

interface PolicyRow {
  orgId: string;
  orgName: string;
  maxAttempts: number;
  retryBaseMs: number;
  attemptsDelta: number;
  retryBaseMsDelta: number;
}

interface PoliciesResponse {
  defaults: { maxAttempts: number; retryBaseMs: number };
  orgs: PolicyRow[];
}

function formatBaseMs(ms: number): string {
  if (ms % 60_000 === 0) {
    const m = ms / 60_000;
    return `${m} min`;
  }
  if (ms >= 1_000) {
    return `${(ms / 1_000).toFixed(1)}s`;
  }
  return `${ms}ms`;
}

function formatDelta(n: number, fmt: (v: number) => string): string {
  if (n === 0) return "—";
  const sign = n > 0 ? "+" : "−";
  return `${sign}${fmt(Math.abs(n))}`;
}

export default function MarketingRetryPoliciesPage() {
  const [, navigate] = useLocation();
  const { user, loading: authLoading } = useAuth();

  const operatorQuery = useQuery<OperatorProbe>({
    queryKey: ["/api/auth/me/platform-operator"],
    enabled: !!user,
  });

  const isOperator = operatorQuery.data?.isPlatformOperator === true;

  const policiesQuery = useQuery<PoliciesResponse>({
    queryKey: ["/api/admin/marketing/retry-policies"],
    enabled: !!user && isOperator,
  });

  if (authLoading || operatorQuery.isLoading) {
    return (
      <div className="p-8 max-w-4xl mx-auto space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="p-8 max-w-4xl mx-auto">
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            Please sign in to continue.
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!isOperator) {
    return (
      <div className="p-8 max-w-4xl mx-auto">
        <Card data-testid="card-operator-required">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldOff className="w-5 h-5" />
              Platform operators only
            </CardTitle>
            <CardDescription>
              This page lists marketing retry settings across every tenant and is restricted to
              platform operators. Tenant admins cannot access it.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" onClick={() => navigate("/settings")} data-testid="button-back-settings">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Settings
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const defaults = policiesQuery.data?.defaults;
  const orgs = policiesQuery.data?.orgs ?? [];

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-6" data-testid="page-marketing-retry-policies">
      <div>
        <button
          className="text-sm text-muted-foreground hover:underline flex items-center gap-1 mb-2"
          onClick={() => navigate("/settings")}
          data-testid="link-back-settings"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Back to Settings
        </button>
        <h1 className="text-2xl font-semibold flex items-center gap-2" style={{ color: "var(--lux-text)" }}>
          <Gauge className="w-6 h-6" /> Aggressive marketing retry policies
        </h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          Orgs whose <code className="font-mono text-xs">marketingSendMaxAttempts</code> or
          {" "}<code className="font-mono text-xs">marketingSendRetryBaseMs</code> differs from the
          platform defaults. A high attempt count combined with a short backoff can amplify load
          on shared transports — investigate any large positive deltas.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Shield className="w-4 h-4" />
            Platform defaults
          </CardTitle>
          <CardDescription>
            The baseline every new tenant inherits, and the values these deltas are computed
            against. Shifts via the <code className="font-mono text-xs">MARKETING_SEND_*</code>{" "}
            env vars re-baseline the list automatically.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {policiesQuery.isLoading ? (
            <Skeleton className="h-6 w-48" />
          ) : defaults ? (
            <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
              <div>
                <span className="text-muted-foreground">Max attempts:</span>{" "}
                <span className="font-mono font-medium" data-testid="text-default-max-attempts">
                  {defaults.maxAttempts}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">Base backoff:</span>{" "}
                <span className="font-mono font-medium" data-testid="text-default-retry-base">
                  {formatBaseMs(defaults.retryBaseMs)}
                </span>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            Orgs off defaults
            <Badge variant="secondary" data-testid="badge-policy-count">
              {orgs.length}
            </Badge>
          </CardTitle>
          <CardDescription>
            Sorted by name. Deltas are <em>configured value − platform default</em>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {policiesQuery.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : policiesQuery.isError ? (
            <p className="text-sm text-destructive" data-testid="text-policies-error">
              Could not load retry policies:{" "}
              {(policiesQuery.error as any)?.message ?? "unknown error"}
            </p>
          ) : orgs.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="text-no-overrides">
              Every org is on platform defaults. Nothing to investigate.
            </p>
          ) : (
            <div className="border rounded-md overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">Organization</th>
                    <th className="text-right px-3 py-2 font-medium">Max attempts</th>
                    <th className="text-right px-3 py-2 font-medium">Δ vs default</th>
                    <th className="text-right px-3 py-2 font-medium">Base backoff</th>
                    <th className="text-right px-3 py-2 font-medium">Δ vs default</th>
                  </tr>
                </thead>
                <tbody>
                  {orgs.map((row) => (
                    <tr
                      key={row.orgId}
                      className="border-t"
                      data-testid={`row-policy-${row.orgId}`}
                    >
                      <td className="px-3 py-2">
                        <div className="font-medium" data-testid={`text-org-name-${row.orgId}`}>
                          {row.orgName}
                        </div>
                        <div className="text-xs text-muted-foreground font-mono">{row.orgId}</div>
                      </td>
                      <td
                        className="px-3 py-2 text-right font-mono"
                        data-testid={`text-max-attempts-${row.orgId}`}
                      >
                        {row.maxAttempts}
                      </td>
                      <td
                        className="px-3 py-2 text-right font-mono"
                        data-testid={`text-attempts-delta-${row.orgId}`}
                      >
                        {formatDelta(row.attemptsDelta, (v) => String(v))}
                      </td>
                      <td
                        className="px-3 py-2 text-right font-mono"
                        data-testid={`text-retry-base-${row.orgId}`}
                      >
                        {formatBaseMs(row.retryBaseMs)}
                      </td>
                      <td
                        className="px-3 py-2 text-right font-mono"
                        data-testid={`text-retry-base-delta-${row.orgId}`}
                      >
                        {formatDelta(row.retryBaseMsDelta, formatBaseMs)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
