import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ArrowLeft, Mail, RefreshCw, Shield, ShieldOff } from "lucide-react";

interface AffectedOrg {
  id: string;
  name: string;
  scopes: string;
  connectedAt: string | null;
}

interface NotifiedRow {
  orgId: string;
  orgName: string;
  adminsEmailed: number;
}

interface RescanResult {
  scanned: number;
  affected: AffectedOrg[];
  notified: NotifiedRow[];
  dryRun: boolean;
}

interface OperatorProbe {
  isPlatformOperator: boolean;
}

function fmtDate(s: string | null): string {
  if (!s) return "—";
  try {
    return new Date(s).toLocaleString();
  } catch {
    return s;
  }
}

export default function M365RescopePage() {
  const [, navigate] = useLocation();
  const { user, loading: authLoading } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [lastNotify, setLastNotify] = useState<RescanResult | null>(null);

  const operatorQuery = useQuery<OperatorProbe>({
    queryKey: ["/api/auth/me/platform-operator"],
    enabled: !!user,
  });

  const isOperator = operatorQuery.data?.isPlatformOperator === true;

  const scanQuery = useQuery<RescanResult>({
    queryKey: ["/api/admin/email/m365-rescope/scan"],
    enabled: !!user && isOperator,
  });

  const notifyMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/email/m365-rescope/notify");
      return (await res.json()) as RescanResult;
    },
    onSuccess: (result) => {
      setLastNotify(result);
      const totalAdmins = result.notified.reduce((sum, n) => sum + n.adminsEmailed, 0);
      toast({
        title: "Reconnect emails sent",
        description: `Notified ${totalAdmins} admin${totalAdmins === 1 ? "" : "s"} across ${result.notified.length} org${result.notified.length === 1 ? "" : "s"}.`,
      });
      qc.invalidateQueries({ queryKey: ["/api/admin/email/m365-rescope/scan"] });
    },
    onError: (err: any) => {
      toast({
        title: "Notify failed",
        description: err?.message || "Could not send reconnect emails. Check server logs.",
        variant: "destructive",
      });
    },
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
              This page runs cross-organization maintenance and is restricted to platform operators.
              Tenant admins cannot access it. If you believe you should have access, ask the platform
              owner to add your email to <code className="font-mono text-xs">PLATFORM_OPERATOR_EMAILS</code>.
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

  const affected = scanQuery.data?.affected ?? [];
  const scanned = scanQuery.data?.scanned ?? 0;

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-6" data-testid="page-m365-rescope">
      <div className="flex items-start justify-between gap-4">
        <div>
          <button
            className="text-sm text-muted-foreground hover:underline flex items-center gap-1 mb-2"
            onClick={() => navigate("/settings")}
            data-testid="link-back-settings"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Back to Settings
          </button>
          <h1 className="text-2xl font-semibold flex items-center gap-2" style={{ color: "var(--lux-text)" }}>
            <Shield className="w-6 h-6" /> Microsoft 365 permissions cleanup
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Find every connected Microsoft 365 mailbox whose stored OAuth grant still includes the
            legacy <code className="font-mono text-xs">User.Read</code> scope, and email each org's
            admins a one-time reconnect nudge so the consent record matches what we actually use.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => scanQuery.refetch()}
          disabled={scanQuery.isFetching}
          data-testid="button-rescan"
        >
          <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${scanQuery.isFetching ? "animate-spin" : ""}`} />
          Rescan
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            Affected organizations
            <Badge variant="secondary" data-testid="badge-affected-count">{scanned}</Badge>
          </CardTitle>
          <CardDescription>
            Dry-run scan — no emails are sent until you click <strong>Notify other affected orgs</strong>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {scanQuery.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : scanQuery.isError ? (
            <p className="text-sm text-destructive" data-testid="text-scan-error">
              Could not load scan: {(scanQuery.error as any)?.message ?? "unknown error"}
            </p>
          ) : affected.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="text-no-affected">
              No organizations are still on the legacy <code className="font-mono text-xs">User.Read</code> scope.
              Nothing to do.
            </p>
          ) : (
            <div className="border rounded-md overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">Organization</th>
                    <th className="text-left px-3 py-2 font-medium">Connected</th>
                    <th className="text-left px-3 py-2 font-medium">Stored scopes</th>
                  </tr>
                </thead>
                <tbody>
                  {affected.map((org) => (
                    <tr key={org.id} className="border-t" data-testid={`row-affected-${org.id}`}>
                      <td className="px-3 py-2">
                        <div className="font-medium" data-testid={`text-org-name-${org.id}`}>{org.name}</div>
                        <div className="text-xs text-muted-foreground font-mono">{org.id}</div>
                      </td>
                      <td className="px-3 py-2 text-xs">{fmtDate(org.connectedAt)}</td>
                      <td className="px-3 py-2 text-xs font-mono break-all max-w-xs">{org.scopes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {affected.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Send reconnect emails</CardTitle>
            <CardDescription>
              Emails every active admin of each affected org (who hasn't muted mailbox alerts) using the
              env-level SMTP fallback. Action is audit-logged under your account.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              onClick={() => setConfirmOpen(true)}
              disabled={notifyMutation.isPending}
              data-testid="button-notify-affected"
            >
              <Mail className="w-4 h-4 mr-2" />
              {notifyMutation.isPending ? "Sending…" : "Notify other affected orgs"}
            </Button>
          </CardContent>
        </Card>
      )}

      {lastNotify && (
        <Card data-testid="card-last-notify">
          <CardHeader>
            <CardTitle className="text-base">Last notify run</CardTitle>
            <CardDescription>
              {lastNotify.notified.length} org{lastNotify.notified.length === 1 ? "" : "s"} processed.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="border rounded-md overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">Organization</th>
                    <th className="text-left px-3 py-2 font-medium">Admins emailed</th>
                  </tr>
                </thead>
                <tbody>
                  {lastNotify.notified.map((n) => (
                    <tr key={n.orgId} className="border-t" data-testid={`row-notified-${n.orgId}`}>
                      <td className="px-3 py-2">{n.orgName}</td>
                      <td className="px-3 py-2 font-mono" data-testid={`text-admins-emailed-${n.orgId}`}>
                        {n.adminsEmailed}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Send reconnect emails to {affected.length} org{affected.length === 1 ? "" : "s"}?</AlertDialogTitle>
            <AlertDialogDescription>
              This emails every eligible admin of each affected organization a one-time nudge to reconnect
              their Microsoft 365 mailbox. The action is audit-logged.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-notify">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmOpen(false);
                notifyMutation.mutate();
              }}
              data-testid="button-confirm-notify"
            >
              Send emails
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
