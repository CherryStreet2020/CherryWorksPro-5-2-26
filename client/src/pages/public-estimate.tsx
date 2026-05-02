import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Check, X, FileCheck, AlertCircle } from "lucide-react";
import { formatMoney, formatDate, formatHours } from "@/components/shared/format";
import { StatusBadge } from "@/components/shared/status-badge";

export default function PublicEstimatePage({ token }: { token: string }) {
  const { data: estimate, isLoading, error } = useQuery<any>({
    queryKey: ["/api/public/estimates", token],
    queryFn: () => fetch(`/api/public/estimates/${token}`).then((r) => {
      if (!r.ok) throw new Error("Not found");
      return r.json();
    }),
  });

  const [actionError, setActionError] = useState<string | null>(null);

  const acceptMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/public/estimates/${token}/accept`),
    onSuccess: () => {
      setActionError(null);
      queryClient.invalidateQueries({ queryKey: ["/api/public/estimates", token] });
    },
    onError: (err: Error) => {
      setActionError(err.message || "Failed to accept estimate. Please try again.");
    },
  });

  const declineMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/public/estimates/${token}/decline`),
    onSuccess: () => {
      setActionError(null);
      queryClient.invalidateQueries({ queryKey: ["/api/public/estimates", token] });
    },
    onError: (err: Error) => {
      setActionError(err.message || "Failed to decline estimate. Please try again.");
    },
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--lux-bg, #f8fafc)" }}>
        <p style={{ color: "var(--lux-text-muted)" }}>Loading estimate...</p>
      </div>
    );
  }

  if (error || !estimate) {
    document.title = "Estimate not found — CherryWorks Pro";
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ background: "var(--lux-bg, #f8fafc)" }}
        data-testid="public-estimate-404"
      >
        <Card className="border-0 max-w-md w-full mx-4" style={{ boxShadow: "var(--lux-card-shadow, 0 8px 32px rgba(0,0,0,0.12))", background: "var(--lux-surface, #fff)" }}>
          <CardContent className="py-16 text-center">
            <AlertCircle className="w-12 h-12 mx-auto mb-3" style={{ color: "var(--lux-text-muted)" }} />
            <p className="font-semibold text-lg" style={{ color: "var(--lux-text)" }} data-testid="text-estimate-not-found">
              Estimate not found
            </p>
            <p className="text-sm mt-1" style={{ color: "var(--lux-text-muted)" }}>
              This link may be invalid or expired.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen py-8 px-4" style={{ background: "var(--lux-bg, #f8fafc)" }}>
      <div className="max-w-3xl mx-auto">
        <div className="text-center mb-8">
          <div className="w-12 h-12 rounded-xl mx-auto mb-3 flex items-center justify-center" style={{ background: "var(--gradient-brand)" }}>
            <FileCheck className="w-6 h-6 text-white" />
          </div>
          <h1 className="text-2xl font-extrabold" style={{ color: "var(--lux-accent)" }}>CherryWorks Pro</h1>
        </div>

        <Card className="border-0" style={{ boxShadow: "var(--lux-card-shadow, 0 8px 32px rgba(0,0,0,0.12))", background: "var(--lux-surface, #fff)" }}>
          <CardContent className="p-6 md:p-8 space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-extrabold" style={{ color: "var(--lux-text)" }}>
                  Estimate {estimate.number}
                </h2>
              </div>
              <StatusBadge status={estimate.status} />
            </div>

            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-[11px] uppercase tracking-wider font-semibold" style={{ color: "var(--lux-text-muted)" }}>Client</span>
                <p className="font-medium" style={{ color: "var(--lux-text)" }} data-testid="text-public-estimate-client">{estimate.clientName}</p>
              </div>
              <div>
                <span className="text-[11px] uppercase tracking-wider font-semibold" style={{ color: "var(--lux-text-muted)" }}>Issued</span>
                <p className="font-medium" style={{ color: "var(--lux-text)" }}>{formatDate(estimate.issuedDate)}</p>
              </div>
              {estimate.expiryDate && (
                <div>
                  <span className="text-[11px] uppercase tracking-wider font-semibold" style={{ color: "var(--lux-text-muted)" }}>Expires</span>
                  <p className="font-medium" style={{ color: "var(--lux-text)" }}>{formatDate(estimate.expiryDate)}</p>
                </div>
              )}
            </div>

            <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--lux-border, #e2e8f0)" }}>
              <Table>
                <TableHeader>
                  <TableRow style={{ background: "var(--lux-table-header-bg, #f8f9fb)" }}>
                    <TableHead className="text-[11px] uppercase tracking-wider font-semibold" style={{ color: "var(--lux-text-muted)" }}>Description</TableHead>
                    <TableHead className="text-right text-[11px] uppercase tracking-wider font-semibold" style={{ color: "var(--lux-text-muted)" }}>Qty</TableHead>
                    <TableHead className="text-right text-[11px] uppercase tracking-wider font-semibold" style={{ color: "var(--lux-text-muted)" }}>Rate</TableHead>
                    <TableHead className="text-right text-[11px] uppercase tracking-wider font-semibold" style={{ color: "var(--lux-text-muted)" }}>Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {estimate.lines?.map((line: any, idx: number) => (
                    <TableRow key={line.id || idx}>
                      <TableCell style={{ color: "var(--lux-text-secondary)" }}>{line.description}</TableCell>
                      <TableCell className="text-right tabular-nums" style={{ color: "var(--lux-text-secondary)" }}>{formatHours(line.quantity)}</TableCell>
                      <TableCell className="text-right tabular-nums" style={{ color: "var(--lux-text-secondary)" }}>{formatMoney(line.unitRate, (estimate as any)?.currency || "USD")}</TableCell>
                      <TableCell className="text-right tabular-nums font-medium" style={{ color: "var(--lux-text)" }}>{formatMoney(line.amount, (estimate as any)?.currency || "USD")}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="pt-4 space-y-1 text-sm text-right" style={{ borderTop: "1px solid var(--lux-border, #e2e8f0)" }}>
              <div style={{ color: "var(--lux-text-muted)" }}>Subtotal: <span className="tabular-nums" style={{ color: "var(--lux-text-secondary)" }}>{formatMoney(estimate.subtotal, (estimate as any)?.currency || "USD")}</span></div>
              {Number(estimate.discountAmount) > 0 && (
                <div style={{ color: "#ef4444" }}>Discount: -{formatMoney(estimate.discountAmount, (estimate as any)?.currency || "USD")}</div>
              )}
              {Number(estimate.taxAmount) > 0 && (
                <div style={{ color: "var(--lux-text-muted)" }}>Tax: <span style={{ color: "var(--lux-text-secondary)" }}>{formatMoney(estimate.taxAmount, (estimate as any)?.currency || "USD")}</span></div>
              )}
              <div className="text-lg font-bold" style={{ color: "var(--lux-accent)" }} data-testid="text-public-estimate-total">
                Total: {formatMoney(estimate.total, (estimate as any)?.currency || "USD")}
              </div>
            </div>

            {estimate.notes && (
              <div className="pt-4" style={{ borderTop: "1px solid var(--lux-border, #e2e8f0)" }}>
                <p className="text-[11px] uppercase tracking-wider font-semibold mb-1" style={{ color: "var(--lux-text-muted)" }}>Notes</p>
                <p className="text-sm" style={{ color: "var(--lux-text-secondary)" }}>{estimate.notes}</p>
              </div>
            )}

            {actionError && (
              <div className="pt-4" style={{ borderTop: "1px solid var(--lux-border, #e2e8f0)" }}>
                <div className="rounded-lg px-4 py-3 text-center" style={{ background: "rgba(239,68,68,0.08)" }}>
                  <p className="text-sm font-medium" style={{ color: "#ef4444" }} data-testid="text-estimate-action-error">{actionError}</p>
                </div>
              </div>
            )}

            {estimate.status === "SENT" && (
              <div className="pt-4 flex gap-3 justify-center" style={{ borderTop: "1px solid var(--lux-border, #e2e8f0)" }}>
                <Button
                  size="lg"
                  className="text-white font-semibold"
                  onClick={() => acceptMutation.mutate()}
                  disabled={acceptMutation.isPending}
                  style={{ background: "#22c55e" }}
                  data-testid="button-public-accept-estimate"
                >
                  <Check className="w-4 h-4 mr-2" /> Accept Estimate
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  onClick={() => declineMutation.mutate()}
                  disabled={declineMutation.isPending}
                  style={{ borderColor: "var(--lux-border)", color: "var(--lux-text)" }}
                  data-testid="button-public-decline-estimate"
                >
                  <X className="w-4 h-4 mr-2" /> Decline
                </Button>
              </div>
            )}

            {estimate.status === "ACCEPTED" && (
              <div className="pt-4 text-center" style={{ borderTop: "1px solid var(--lux-border, #e2e8f0)" }}>
                <div className="inline-flex items-center gap-2 px-4 py-2 rounded-lg" style={{ background: "rgba(34,197,94,0.08)" }}>
                  <Check className="w-4 h-4" style={{ color: "#22c55e" }} />
                  <p className="font-medium" style={{ color: "#22c55e" }} data-testid="text-estimate-accepted-msg">
                    This estimate has been accepted. Thank you!
                  </p>
                </div>
              </div>
            )}

            {estimate.status === "DECLINED" && (
              <div className="pt-4 text-center" style={{ borderTop: "1px solid var(--lux-border, #e2e8f0)" }}>
                <div className="inline-flex items-center gap-2 px-4 py-2 rounded-lg" style={{ background: "rgba(239,68,68,0.08)" }}>
                  <X className="w-4 h-4" style={{ color: "#ef4444" }} />
                  <p className="font-medium" style={{ color: "#ef4444" }} data-testid="text-estimate-declined-msg">
                    This estimate has been declined.
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <p className="text-center text-xs mt-6" style={{ color: "var(--lux-text-muted)" }}>
          Powered by CherryWorks Pro
        </p>
      </div>
    </div>
  );
}
