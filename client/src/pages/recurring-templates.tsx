import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { PageHelpLink } from "@/components/page-help-link";
import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Plus, RefreshCw, Pause, X, FileText, DollarSign, Calendar, Layers, ArrowLeft } from "lucide-react";
import { useLocation } from "wouter";
import { StatusBadge } from "@/components/shared/status-badge";
import { DateDisplay } from "@/components/shared/date-display";
import { EmptyState } from "@/components/shared/empty-state";
import { MoneyDisplay } from "@/components/shared/money-display";
import { FormSection } from "@/components/shared/form-section";
import { StatCard } from "@/components/shared/stat-card";
import { formatMoney } from "@/components/shared/format";
import { useBaseCurrency } from "@/hooks/use-base-currency";
import { useDocumentTitle } from "@/lib/use-document-title";

interface TemplateLine {
  description: string;
  quantity: number;
  unitRate: number;
}

export default function RecurringTemplatesPage() {
  useDocumentTitle("Recurring Templates");
  const { toast } = useToast();
  const baseCurrency = useBaseCurrency();
  const [, setLocation] = useLocation();
  const [open, setOpen] = useState(false);
  const [clientId, setClientId] = useState("");
  const [frequency, setFrequency] = useState("MONTHLY");
  const [dayOfMonth, setDayOfMonth] = useState("1");
  const [nextIssueDate, setNextIssueDate] = useState("");
  const [taxRate, setTaxRate] = useState("0");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<TemplateLine[]>([
    { description: "", quantity: 1, unitRate: 0 },
  ]);

  const { data: templates = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/recurring-templates"],
  });

  const { data: clients = [] } = useQuery<any[]>({
    queryKey: ["/api/clients"],
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/recurring-templates", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/recurring-templates"] });
      setOpen(false);
      resetForm();
      toast({ title: "Recurring template created" });
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/recurring-templates/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/recurring-templates"] });
      toast({ title: "Template deactivated" });
    },
  });

  const generateMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/recurring-templates/${id}/generate`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/recurring-templates"] });
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      toast({ title: "Invoice generated from template" });
    },
    onError: (err: any) => {
      toast({ title: "Failed to generate invoice", description: err.message, variant: "destructive" });
    },
  });

  function resetForm() {
    setClientId("");
    setFrequency("MONTHLY");
    setDayOfMonth("1");
    setNextIssueDate("");
    setTaxRate("0");
    setNotes("");
    setLines([{ description: "", quantity: 1, unitRate: 0 }]);
  }

  function addLine() {
    setLines([...lines, { description: "", quantity: 1, unitRate: 0 }]);
  }

  function updateLine(idx: number, field: keyof TemplateLine, value: any) {
    const updated = [...lines];
    updated[idx] = { ...updated[idx], [field]: value };
    setLines(updated);
  }

  function removeLine(idx: number) {
    if (lines.length <= 1) return;
    setLines(lines.filter((_, i) => i !== idx));
  }

  function handleSubmit() {
    const validLines = lines.filter((l) => l.description.trim());
    if (!clientId || !nextIssueDate || validLines.length === 0) {
      toast({ title: "Client, next issue date, and at least one line required", variant: "destructive" });
      return;
    }
    createMutation.mutate({
      clientId,
      frequency,
      dayOfMonth: frequency === "MONTHLY" || frequency === "QUARTERLY" ? Number(dayOfMonth) : null,
      nextIssueDate,
      templateLines: validLines,
      taxRate: Number(taxRate),
      notes: notes || null,
    });
  }

  const freqLabels: Record<string, string> = {
    WEEKLY: "Weekly",
    BIWEEKLY: "Bi-Weekly",
    MONTHLY: "Monthly",
    QUARTERLY: "Quarterly",
  };

  return (
    <div className="px-6 lg:px-8 xl:px-10 py-6 space-y-6">
      <button
        onClick={() => setLocation("/invoices")}
        className="flex items-center gap-1 text-xs hover:underline w-fit"
        style={{ color: "var(--lux-text-muted)" }}
        data-testid="button-back-invoices"
      >
        <ArrowLeft className="w-3 h-3" /> Back to Invoices
      </button>
      <PageBreadcrumbs
        page="Recurring Templates"
        showDashboard={false}
        items={[{ label: "Invoices", href: "/invoices", testId: "button-crumb-invoices" }]}
      />
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="relative">
            <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: "linear-gradient(135deg, rgba(var(--lux-accent-rgb),0.15) 0%, rgba(var(--lux-accent-rgb),0.05) 100%)" }}>
              <RefreshCw className="w-6 h-6" style={{ color: "var(--lux-accent)" }} />
            </div>
          </div>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight" style={{ color: "var(--lux-text)" }} data-testid="text-page-title">
                Recurring Invoice Templates
              </h1>
              <PageHelpLink />
            </div>
            <p className="text-sm mt-0.5" style={{ color: "var(--lux-text-muted)" }}>
              Set up automatic recurring invoices
            </p>
          </div>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-new-recurring">
              <Plus className="w-4 h-4 mr-2" /> New Template
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto" style={{ background: "var(--lux-surface)", borderColor: "var(--lux-border)" }}>
            <DialogHeader>
              <DialogTitle style={{ color: "var(--lux-text)" }}>Create Recurring Template</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <FormSection title="Client & Schedule">
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>Client</Label>
                      <Select value={clientId} onValueChange={setClientId}>
                        <SelectTrigger data-testid="select-recurring-client">
                          <SelectValue placeholder="Select client" />
                        </SelectTrigger>
                        <SelectContent>
                          {clients.map((c: any) => (
                            <SelectItem key={c.id} value={c.id}>
                              {c.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Frequency</Label>
                      <Select value={frequency} onValueChange={setFrequency}>
                        <SelectTrigger data-testid="select-recurring-frequency">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="WEEKLY">Weekly</SelectItem>
                          <SelectItem value="BIWEEKLY">Bi-Weekly</SelectItem>
                          <SelectItem value="MONTHLY">Monthly</SelectItem>
                          <SelectItem value="QUARTERLY">Quarterly</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>Next Issue Date</Label>
                      <Input
                        type="date"
                        value={nextIssueDate}
                        onChange={(e) => setNextIssueDate(e.target.value)}
                        data-testid="input-recurring-next-date"
                      />
                    </div>
                    {(frequency === "MONTHLY" || frequency === "QUARTERLY") && (
                      <div>
                        <Label>Day of Month</Label>
                        <Input
                          type="number"
                          min="1"
                          max="28"
                          value={dayOfMonth}
                          onChange={(e) => setDayOfMonth(e.target.value)}
                          data-testid="input-recurring-day"
                        />
                      </div>
                    )}
                  </div>
                </div>
              </FormSection>
              <FormSection title="Billing">
                <div>
                  <Label>Tax Rate (%)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={taxRate}
                    onChange={(e) => setTaxRate(e.target.value)}
                    data-testid="input-recurring-tax-rate"
                  />
                </div>
              </FormSection>
              <FormSection title="Line Items">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <Label>Template Line Items</Label>
                    <Button size="sm" variant="outline" onClick={addLine} data-testid="button-add-recurring-line">
                      <Plus className="w-3 h-3 mr-1" /> Add Line
                    </Button>
                  </div>
                  <div className="space-y-2">
                    {lines.map((line, idx) => (
                      <div key={idx} className="flex gap-2 items-end">
                        <div className="flex-1">
                          <Input
                            placeholder="Description"
                            value={line.description}
                            onChange={(e) => updateLine(idx, "description", e.target.value)}
                            data-testid={`input-recurring-line-desc-${idx}`}
                          />
                        </div>
                        <div className="w-20">
                          <Input
                            type="number"
                            placeholder="Qty"
                            value={line.quantity}
                            onChange={(e) => updateLine(idx, "quantity", Number(e.target.value))}
                            data-testid={`input-recurring-line-qty-${idx}`}
                          />
                        </div>
                        <div className="w-28">
                          <Input
                            type="number"
                            step="0.01"
                            placeholder="Rate"
                            value={line.unitRate}
                            onChange={(e) => updateLine(idx, "unitRate", Number(e.target.value))}
                            data-testid={`input-recurring-line-rate-${idx}`}
                          />
                        </div>
                        <div className="w-20 text-right">
                          <MoneyDisplay currency={baseCurrency} value={line.quantity * line.unitRate} size="xs" />
                        </div>
                        {lines.length > 1 && (
                          <Button size="sm" variant="ghost" onClick={() => removeLine(idx)}>
                            <X className="w-3 h-3" />
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </FormSection>
              <Button
                className="w-full text-white"
                style={{ background: "var(--gradient-brand)" }}
                onClick={handleSubmit}
                disabled={createMutation.isPending}
                data-testid="button-submit-recurring"
              >
                {createMutation.isPending ? "Creating..." : "Create Template"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          icon={Layers}
          label="Total Templates"
          value={String(templates.length)}
          testId="stat-total-templates"
        />
        <StatCard
          icon={Calendar}
          label="Active"
          value={String(templates.filter((t: any) => t.isActive).length)}
          color="#22c55e"
          testId="stat-active-templates"
        />
        <StatCard
          icon={DollarSign}
          label="Total Value"
          value={formatMoney(templates.reduce((sum: number, t: any) => {
            const lineTotal = Array.isArray(t.templateLines)
              ? t.templateLines.reduce((s: number, l: any) => s + (l.quantity * l.unitRate), 0)
              : 0;
            return sum + lineTotal;
          }, 0))}
          testId="stat-total-value"
        />
      </div>

      <Card className="border-0" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider" style={{ color: "var(--lux-text-secondary)" }}>
            <RefreshCw className="w-4 h-4" /> Recurring Templates
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm" style={{ color: "var(--lux-text-muted)" }}>Loading...</p>
          ) : templates.length === 0 ? (
            <EmptyState
              icon={RefreshCw}
              title="No recurring templates"
              description="Create a template to automate recurring invoices"
              action={() => setOpen(true)}
              actionLabel="New Template"
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow style={{ background: "var(--lux-table-header-bg)" }}>
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>Client</TableHead>
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>Frequency</TableHead>
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>Next Issue</TableHead>
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>Lines</TableHead>
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>Status</TableHead>
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {templates.map((tmpl: any) => (
                  <TableRow key={tmpl.id} data-testid={`row-recurring-${tmpl.id}`} className="transition-colors" style={{ borderColor: "var(--lux-border)" }}>
                    <TableCell data-testid={`text-recurring-client-${tmpl.id}`}>
                      {tmpl.clientName}
                    </TableCell>
                    <TableCell data-testid={`text-recurring-freq-${tmpl.id}`}>
                      {freqLabels[tmpl.frequency] || tmpl.frequency}
                    </TableCell>
                    <TableCell><DateDisplay value={tmpl.nextIssueDate} /></TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span>{Array.isArray(tmpl.templateLines) ? tmpl.templateLines.length : 0} items</span>
                        <MoneyDisplay currency={baseCurrency}
                          value={Array.isArray(tmpl.templateLines)
                            ? tmpl.templateLines.reduce((s: number, l: any) => s + (l.quantity * l.unitRate), 0)
                            : 0}
                          size="xs"
                        />
                      </div>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={tmpl.isActive ? "ACTIVE" : "ARCHIVED"} />
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        {tmpl.isActive && (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => generateMutation.mutate(tmpl.id)}
                              disabled={generateMutation.isPending}
                              data-testid={`button-generate-invoice-${tmpl.id}`}
                            >
                              <FileText className="w-3 h-3 mr-1" /> Generate Invoice
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => deactivateMutation.mutate(tmpl.id)}
                              disabled={deactivateMutation.isPending}
                              data-testid={`button-deactivate-recurring-${tmpl.id}`}
                            >
                              <Pause className="w-3 h-3 mr-1" /> Deactivate
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
