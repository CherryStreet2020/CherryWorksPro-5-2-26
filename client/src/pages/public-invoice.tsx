import { Fragment, useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Download, CreditCard, AlertCircle, FileText } from "lucide-react";
import { formatMoney, formatDate, formatPercent, formatHours } from "@/components/shared/format";
import { isValidStripeUrl } from "@/lib/url-validation";
import { StatusBadge } from "@/components/shared/status-badge";
import { InvoiceDetailRows, type DetailItem } from "@/components/shared/invoice-detail-rows";

interface PublicLine {
  id?: string;
  description: string;
  quantity: string;
  unitRate: string;
  amount: string;
  isHeader?: boolean;
}

interface PublicInvoiceData {
  number: string;
  status: string;
  issuedDate: string;
  dueDate: string;
  clientName: string;
  currency?: string;
  portalToken?: string | null;
  lines: PublicLine[];
  subtotal: string;
  discountType: string;
  discountValue: string;
  discountAmount: string;
  taxRate: string;
  taxAmount: string;
  total: string;
  paidAmount: string;
  outstanding: string;
  stripeEnabled: boolean;
  showTimeEntryDetails?: boolean;
  lineDetails?: Record<string, DetailItem[]>;
}

export default function PublicInvoicePage({ token }: { token: string }) {
  const [data, setData] = useState<PublicInvoiceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [payLoading, setPayLoading] = useState(false);

  useEffect(() => {
    fetch(`/api/public/invoices/${token}`)
      .then((res) => {
        if (!res.ok) {
          setNotFound(true);
          setLoading(false);
          return null;
        }
        return res.json();
      })
      .then((json) => {
        if (json) setData(json);
        setLoading(false);
      })
      .catch(() => {
        setNotFound(true);
        setLoading(false);
      });
  }, [token]);

  if (loading) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ background: "var(--lux-bg, #f8fafc)" }}
      >
        <div className="space-y-4 w-full max-w-2xl px-4">
          <Skeleton className="h-10 w-48 mx-auto rounded" />
          <Skeleton className="h-64 rounded-xl" />
        </div>
      </div>
    );
  }

  if (notFound || !data) {
    document.title = "Invoice not found — CherryWorks Pro";
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ background: "var(--lux-bg, #f8fafc)" }}
        data-testid="public-invoice-404"
      >
        <Card className="border-0 max-w-md w-full mx-4" style={{ boxShadow: "var(--lux-card-shadow, 0 8px 32px rgba(0,0,0,0.12))", background: "var(--lux-surface, #fff)" }}>
          <CardContent className="py-16 text-center">
            <AlertCircle className="w-12 h-12 mx-auto mb-3" style={{ color: "var(--lux-text-muted)" }} />
            <p className="font-semibold text-lg" style={{ color: "var(--lux-text)" }}>
              Invoice not found
            </p>
            <p className="text-sm mt-1" style={{ color: "var(--lux-text-muted)" }}>
              This link may be invalid or expired.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  async function handlePay() {
    setPayLoading(true);
    try {
      const res = await fetch(`/api/public/invoices/${token}/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        console.error("[public-invoice] Checkout failed:", errData.message || res.statusText);
        setPayLoading(false);
        return;
      }
      const json = await res.json();
      if (json.url) {
        if (isValidStripeUrl(json.url)) {
          window.location.href = json.url;
        } else {
          console.error("Invalid Stripe redirect URL blocked:", json.url);
          setPayLoading(false);
        }
      }
    } catch {
      setPayLoading(false);
    }
  }

  const outstanding = Number(data.outstanding);

  return (
    <div className="min-h-screen" style={{ background: "var(--lux-bg, #f8fafc)" }}>
      <div className="max-w-3xl mx-auto py-8 px-4">
        <div className="text-center mb-8">
          <div className="w-12 h-12 rounded-xl mx-auto mb-3 flex items-center justify-center" style={{ background: "var(--gradient-brand)" }}>
            <FileText className="w-6 h-6 text-white" />
          </div>
          <h1
            className="text-2xl font-extrabold"
            style={{ color: "var(--lux-accent)" }}
            data-testid="text-brand-title"
          >
            CherryWorks Pro
          </h1>
        </div>

        <Card className="border-0" style={{ boxShadow: "var(--lux-card-shadow, 0 8px 32px rgba(0,0,0,0.12))", background: "var(--lux-surface, #fff)" }} data-testid="card-public-invoice">
          <CardContent className="p-6 md:p-8">
            <div className="flex items-start justify-between flex-wrap gap-4 mb-6">
              <div>
                <h2
                  className="text-xl font-extrabold"
                  style={{ color: "var(--lux-text)" }}
                  data-testid="text-invoice-number"
                >
                  {data.number}
                </h2>
                <p className="text-sm mt-1" style={{ color: "var(--lux-text-muted)" }}>
                  Issued to{" "}
                  <span className="font-medium" style={{ color: "var(--lux-text-secondary)" }} data-testid="text-client-name">
                    {data.clientName}
                  </span>
                </p>
              </div>
              <StatusBadge status={data.status} />
            </div>

            <div className="grid grid-cols-2 gap-4 text-sm mb-6">
              <div>
                <p style={{ color: "var(--lux-text-muted)" }} className="text-[11px] uppercase tracking-wider font-semibold">
                  Issue Date
                </p>
                <p style={{ color: "var(--lux-text-secondary)" }} data-testid="text-issue-date" className="font-medium">
                  {formatDate(data.issuedDate)}
                </p>
              </div>
              <div>
                <p style={{ color: "var(--lux-text-muted)" }} className="text-[11px] uppercase tracking-wider font-semibold">
                  Due Date
                </p>
                <p style={{ color: "var(--lux-text-secondary)" }} data-testid="text-due-date" className="font-medium">
                  {formatDate(data.dueDate)}
                </p>
              </div>
            </div>

            <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--lux-border, #e2e8f0)" }}>
              <table className="w-full text-sm" data-testid="table-lines">
                <thead>
                  <tr style={{ background: "var(--lux-table-header-bg, #f8f9fb)" }}>
                    <th
                      className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider"
                      style={{ color: "var(--lux-text-muted)" }}
                    >
                      Description
                    </th>
                    <th
                      className="text-right px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider"
                      style={{ color: "var(--lux-text-muted)" }}
                    >
                      Qty
                    </th>
                    <th
                      className="text-right px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider"
                      style={{ color: "var(--lux-text-muted)" }}
                    >
                      Rate
                    </th>
                    <th
                      className="text-right px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider"
                      style={{ color: "var(--lux-text-muted)" }}
                    >
                      Amount
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.lines.map((line, i) => {
                    const detailItems = data.showTimeEntryDetails && line.id
                      ? data.lineDetails?.[line.id]
                      : undefined;
                    if (line.isHeader) {
                      return (
                        <tr
                          key={i}
                          style={{ borderTop: "1px solid var(--lux-border, #e2e8f0)", background: "var(--lux-bg, #f8fafc)" }}
                          data-testid={`row-public-header-${i}`}
                        >
                          <td colSpan={4} className="px-4 py-2 text-sm font-bold" style={{ color: "var(--lux-text)" }}>
                            {line.description}
                          </td>
                        </tr>
                      );
                    }
                    return (
                      // React.Fragment with a stable key avoids the
                      // "each child in a list should have a unique key"
                      // warning that the bare `<>` form produced.
                      <Fragment key={`line-${i}`}>
                        <tr
                          style={{ borderTop: "1px solid var(--lux-border, #e2e8f0)" }}
                          data-testid={`row-public-line-${i}`}
                        >
                          <td className="px-4 py-2.5" style={{ color: "var(--lux-text-secondary)" }}>
                            {line.description}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums" style={{ color: "var(--lux-text-secondary)" }}>
                            {formatHours(line.quantity)}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums" style={{ color: "var(--lux-text-secondary)" }}>
                            {formatMoney(line.unitRate, data?.currency || "USD")}
                          </td>
                          <td
                            className="px-4 py-2.5 text-right font-medium tabular-nums"
                            style={{ color: "var(--lux-text)" }}
                            data-testid={`text-public-line-amount-${i}`}
                          >
                            {formatMoney(line.amount, data?.currency || "USD")}
                          </td>
                        </tr>
                        {detailItems && detailItems.length > 0 && (
                          <InvoiceDetailRows
                            items={detailItems}
                            colSpan={4}
                            testIdPrefix={`public-detail-${i}`}
                          />
                        )}
                      </Fragment>
                    );
                  })}
                  {(() => {
                    const unallocated = data.showTimeEntryDetails
                      ? data.lineDetails?.["__unallocated__"]
                      : undefined;
                    if (!unallocated || unallocated.length === 0) return null;
                    return (
                      <Fragment key="unallocated">
                        <tr
                          style={{
                            borderTop: "1px solid var(--lux-border, #e2e8f0)",
                            background: "var(--lux-bg, #f8fafc)",
                          }}
                          data-testid="row-public-unallocated-worklog-header"
                        >
                          <td
                            colSpan={4}
                            className="px-4 py-2 text-sm font-bold uppercase tracking-wider"
                            style={{ color: "var(--lux-text)" }}
                          >
                            Additional worklog (unbilled time for this client)
                          </td>
                        </tr>
                        <InvoiceDetailRows
                          items={unallocated}
                          colSpan={4}
                          testIdPrefix="public-detail-unallocated"
                        />
                      </Fragment>
                    );
                  })()}
                </tbody>
                <tfoot>
                  <tr style={{ borderTop: "1px solid var(--lux-border, #e2e8f0)" }}>
                    <td colSpan={3} className="px-4 py-2 text-right text-sm" style={{ color: "var(--lux-text-muted)" }}>
                      Subtotal
                    </td>
                    <td
                      className="px-4 py-2 text-right font-medium tabular-nums text-sm"
                      style={{ color: "var(--lux-text-secondary)" }}
                      data-testid="text-public-subtotal"
                    >
                      {formatMoney(data.subtotal, data?.currency || "USD")}
                    </td>
                  </tr>
                  {Number(data.discountAmount) > 0 && (
                    <tr style={{ borderTop: "1px solid var(--lux-border, #e2e8f0)" }}>
                      <td colSpan={3} className="px-4 py-2 text-right text-sm" style={{ color: "var(--lux-text-muted)" }}>
                        Discount{data.discountType === "PERCENT" ? ` (${formatPercent(data.discountValue)})` : ""}
                      </td>
                      <td
                        className="px-4 py-2 text-right font-medium tabular-nums text-sm"
                        style={{ color: "#ef4444" }}
                        data-testid="text-public-discount"
                      >
                        -{formatMoney(data.discountAmount, data?.currency || "USD")}
                      </td>
                    </tr>
                  )}
                  {Number(data.taxAmount) > 0 && (
                    <tr style={{ borderTop: "1px solid var(--lux-border, #e2e8f0)" }}>
                      <td colSpan={3} className="px-4 py-2 text-right text-sm" style={{ color: "var(--lux-text-muted)" }}>
                        Tax ({formatPercent(data.taxRate)})
                      </td>
                      <td
                        className="px-4 py-2 text-right font-medium tabular-nums text-sm"
                        style={{ color: "var(--lux-text-secondary)" }}
                        data-testid="text-public-tax"
                      >
                        {formatMoney(data.taxAmount, data?.currency || "USD")}
                      </td>
                    </tr>
                  )}
                  <tr style={{ borderTop: "2px solid var(--lux-text, #0f172a)" }}>
                    <td colSpan={3} className="px-4 py-3 text-right font-bold text-sm" style={{ color: "var(--lux-text)" }}>
                      Total
                    </td>
                    <td
                      className="px-4 py-3 text-right font-bold text-base tabular-nums"
                      style={{ color: "var(--lux-accent)" }}
                      data-testid="text-public-total"
                    >
                      {formatMoney(data.total, data?.currency || "USD")}
                    </td>
                  </tr>
                  {Number(data.paidAmount) > 0 && (
                    <>
                      <tr style={{ borderTop: "1px solid var(--lux-border, #e2e8f0)" }}>
                        <td colSpan={3} className="px-4 py-2 text-right text-sm" style={{ color: "var(--lux-text-muted)" }}>
                          Paid
                        </td>
                        <td
                          className="px-4 py-2 text-right font-medium tabular-nums"
                          style={{ color: "#22c55e" }}
                          data-testid="text-public-paid"
                        >
                          {formatMoney(data.paidAmount, data?.currency || "USD")}
                        </td>
                      </tr>
                      <tr style={{ borderTop: "1px solid var(--lux-border, #e2e8f0)" }}>
                        <td colSpan={3} className="px-4 py-2 text-right text-sm font-bold" style={{ color: "var(--lux-text)" }}>
                          Outstanding
                        </td>
                        <td
                          className="px-4 py-2 text-right font-bold tabular-nums"
                          style={{ color: "var(--lux-accent)" }}
                          data-testid="text-public-outstanding"
                        >
                          {formatMoney(data.outstanding, data?.currency || "USD")}
                        </td>
                      </tr>
                    </>
                  )}
                </tfoot>
              </table>
            </div>

            <div className="flex gap-3 mt-6 flex-wrap">
              <a
                href={`/api/public/invoices/${token}/pdf`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Button variant="outline" style={{ borderColor: "var(--lux-border)", color: "var(--lux-text)" }} data-testid="button-public-download-pdf">
                  <Download className="w-4 h-4 mr-2" />
                  Download PDF
                </Button>
              </a>
              {data.portalToken && (
                <a href={`/portal/${data.portalToken}`}>
                  <Button variant="outline" style={{ borderColor: "var(--lux-border)", color: "var(--lux-text)" }} data-testid="button-view-all-invoices">
                    <FileText className="w-4 h-4 mr-2" />
                    View All Invoices
                  </Button>
                </a>
              )}
              {outstanding > 0 && (
                data.stripeEnabled ? (
                  <div className="flex flex-col items-end gap-1.5">
                    <Button
                      onClick={handlePay}
                      disabled={payLoading}
                      className="text-white h-11 font-semibold"
                      style={{ background: "var(--gradient-brand)" }}
                      data-testid="button-pay-now"
                    >
                      <CreditCard className="w-4 h-4 mr-2" />
                      {payLoading ? "Redirecting..." : `Pay by Card or Bank Transfer`}
                    </Button>
                    <p className="text-[11px]" style={{ color: "var(--lux-text-muted)" }} data-testid="text-pay-note">
                      Pay securely by credit card or bank transfer. Bank transfers have lower processing fees.
                    </p>
                  </div>
                ) : (
                  <div
                    className="flex items-center gap-2 px-3 py-2 rounded-md text-sm"
                    style={{ background: "rgba(var(--lux-accent-rgb, 139,92,246), 0.06)", color: "var(--lux-text-muted)" }}
                    data-testid="text-payments-not-enabled"
                  >
                    <CreditCard className="w-4 h-4" />
                    Online payments not enabled
                  </div>
                )
              )}
            </div>
          </CardContent>
        </Card>

        <p className="text-center text-xs mt-6" style={{ color: "var(--lux-text-muted)" }}>
          Powered by CherryWorks Pro
        </p>
      </div>
    </div>
  );
}
