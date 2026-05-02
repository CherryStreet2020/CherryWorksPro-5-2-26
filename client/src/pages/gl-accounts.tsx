import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { ErrorState } from "@/components/shared/error-state";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { PageHelpLink } from "@/components/page-help-link";
import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import { useToast } from "@/hooks/use-toast";
import type { GlAccount } from "@shared/schema";
import {
  BookOpen, Plus, Database, Archive, CheckCircle, Pencil, Search, X,
} from "lucide-react";
import { useLocation, Link } from "wouter";

interface GlAccountWithBalance extends GlAccount {
  balance: string;
}
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { formatMoney } from "@/components/shared/format";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useDocumentTitle } from "@/lib/use-document-title";

const ACCOUNT_TYPES = [
  "ASSET", "LIABILITY", "EQUITY", "REVENUE", "COST_OF_SERVICES", "EXPENSE",
] as const;

const TYPE_COLORS: Record<string, { bg: string; text: string; row: string }> = {
  ASSET: { bg: "rgba(34,197,94,0.12)", text: "#22c55e", row: "rgba(34,197,94,0.04)" },
  LIABILITY: { bg: "rgba(239,68,68,0.12)", text: "#ef4444", row: "rgba(239,68,68,0.04)" },
  EQUITY: { bg: "rgba(168,85,247,0.12)", text: "#a855f7", row: "rgba(168,85,247,0.04)" },
  REVENUE: { bg: "rgba(59,130,246,0.12)", text: "#3b82f6", row: "rgba(59,130,246,0.04)" },
  COST_OF_SERVICES: { bg: "rgba(245,158,11,0.12)", text: "#f59e0b", row: "rgba(245,158,11,0.04)" },
  EXPENSE: { bg: "rgba(245,158,11,0.12)", text: "#f59e0b", row: "rgba(245,158,11,0.04)" },
};

function formatType(t: string) {
  return t.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

export default function GLAccountsPage() {
  useDocumentTitle("Chart of Accounts");
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editAccount, setEditAccount] = useState<GlAccount | null>(null);

  const { data: accounts = [], isLoading, isError, refetch } = useQuery<GlAccountWithBalance[]>({
    queryKey: ["/api/gl/accounts"],
  });

  const seedMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/gl/accounts/seed"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/gl/accounts"] });
      toast({ title: "Default accounts seeded" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/gl/accounts", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/gl/accounts"] });
      setDialogOpen(false);
      toast({ title: "Account created" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...data }: any) => apiRequest("PATCH", `/api/gl/accounts/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/gl/accounts"] });
      setDialogOpen(false);
      setEditAccount(null);
      toast({ title: "Account updated" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const archiveMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/gl/accounts/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/gl/accounts"] });
      toast({ title: "Account archived" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const [searchQuery, setSearchQuery] = useState("");

  const sorted = [...accounts]
    .filter(a => {
      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
      return a.accountNumber.toLowerCase().includes(q) || a.name.toLowerCase().includes(q) || (a.accountType || "").toLowerCase().includes(q);
    })
    .sort((a, b) => {
      const numA = parseInt(a.accountNumber, 10) || 0;
      const numB = parseInt(b.accountNumber, 10) || 0;
      return numA - numB;
    });

  return (
    <div className="px-6 lg:px-8 xl:px-10 py-6 space-y-6">
      <PageBreadcrumbs
        page="Chart of Accounts"
        showDashboard={false}
        items={[{ label: "Accounting", href: "/accounting", testId: "link-breadcrumb-accounting" }]}
      />
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: "linear-gradient(135deg, rgba(var(--lux-accent-rgb),0.15) 0%, rgba(var(--lux-accent-rgb),0.05) 100%)" }}>
            <BookOpen className="w-6 h-6" style={{ color: "var(--lux-accent)" }} />
          </div>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight" style={{ color: "var(--lux-text)" }} data-testid="text-page-title">
                Chart of Accounts
              </h1>
              <PageHelpLink />
            </div>
            <p className="text-sm mt-0.5" style={{ color: "var(--lux-text-muted)" }}>
              {accounts.length} account{accounts.length !== 1 ? "s" : ""}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5" style={{ color: "var(--lux-text-muted)" }} />
              <Input
                className="pl-8 pr-8 h-8 w-56 text-sm"
                placeholder="Search by # or name..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                data-testid="input-search-accounts"
              />
              {searchQuery && (
                <button
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-black/10 dark:hover:bg-white/10"
                  onClick={() => setSearchQuery("")}
                  data-testid="button-clear-search"
                  aria-label="Clear search"
                >
                  <X className="w-3.5 h-3.5" style={{ color: "var(--lux-text-muted)" }} />
                </button>
              )}
            </div>
            {searchQuery && (
              <span className="text-xs tabular-nums whitespace-nowrap" style={{ color: "var(--lux-text-muted)" }} data-testid="text-search-count">
                {sorted.length} of {accounts.length}
              </span>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => seedMutation.mutate()}
            disabled={seedMutation.isPending}
            data-testid="button-seed-accounts"
          >
            <Database className="w-4 h-4 mr-1.5" />
            {seedMutation.isPending ? "Seeding..." : "Seed Default Accounts"}
          </Button>
          <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) setEditAccount(null); }}>
            <DialogTrigger asChild>
              <Button size="sm" className="text-white" data-testid="button-add-account" style={{ background: "var(--gradient-brand)" }}>
                <Plus className="w-4 h-4 mr-1.5" />
                Add Account
              </Button>
            </DialogTrigger>
            <DialogContent style={{ background: "var(--lux-surface)", borderColor: "var(--lux-border)" }}>
              <DialogHeader>
                <DialogTitle style={{ color: "var(--lux-text)" }}>{editAccount ? "Edit Account" : "Add Account"}</DialogTitle>
              </DialogHeader>
              <AccountForm
                initial={editAccount}
                isPending={editAccount ? updateMutation.isPending : createMutation.isPending}
                onSubmit={(data) => {
                  if (editAccount) {
                    updateMutation.mutate({ id: editAccount.id, ...data });
                  } else {
                    createMutation.mutate(data);
                  }
                }}
              />
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="rounded-xl border-0 overflow-hidden" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }}>
        <Table>
          <TableHeader>
            <TableRow style={{ background: "var(--lux-table-header-bg)" }}>
              <TableHead className="w-[100px] text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>Account #</TableHead>
              <TableHead className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>Name</TableHead>
              <TableHead className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>Type</TableHead>
              <TableHead className="text-right text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>Balance</TableHead>
              <TableHead className="text-center text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>Status</TableHead>
              <TableHead className="w-[80px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isError ? (
              <TableRow>
                <TableCell colSpan={6}>
                  <ErrorState title="Failed to load accounts" onRetry={refetch} />
                </TableCell>
              </TableRow>
            ) : isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={6}><div className="h-8 rounded animate-pulse" style={{ background: "var(--lux-border)" }} /></TableCell>
                </TableRow>
              ))
            ) : sorted.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-12">
                  <div className="space-y-2">
                    <BookOpen className="w-8 h-8 mx-auto" style={{ color: "var(--lux-text-muted)" }} />
                    <p className="text-sm font-medium" style={{ color: "var(--lux-text-muted)" }}>No accounts yet</p>
                    <p className="text-xs" style={{ color: "var(--lux-text-muted)" }}>
                      Click "Seed Default Accounts" to get started
                    </p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              sorted.map((acct) => {
                const colors = TYPE_COLORS[acct.accountType] || TYPE_COLORS.EXPENSE;
                return (
                  <TableRow
                    key={acct.id}
                    style={{ background: acct.isActive ? colors.row : "transparent", cursor: "pointer" }}
                    className="hover:opacity-80 transition-opacity"
                    onClick={() => navigate(`/gl/journal-entries?accountId=${acct.id}`)}
                    data-testid={`row-account-${acct.id}`}
                  >
                    <TableCell className="font-sans tabular-nums text-sm font-semibold" data-testid={`text-account-number-${acct.id}`}>
                      {acct.accountNumber}
                    </TableCell>
                    <TableCell>
                      <span className="font-medium text-sm" style={{ color: "var(--lux-text)" }} data-testid={`text-account-name-${acct.id}`}>
                        {acct.name}
                      </span>
                      {acct.description && (
                        <p className="text-xs mt-0.5" style={{ color: "var(--lux-text-muted)" }}>{acct.description}</p>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="secondary"
                        className="text-[10px] font-semibold uppercase"
                        style={{ background: colors.bg, color: colors.text, border: "none" }}
                        data-testid={`badge-account-type-${acct.id}`}
                      >
                        {formatType(acct.accountType)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm font-medium" style={{ color: Number(acct.balance) !== 0 ? "var(--lux-text)" : "var(--lux-text-muted)" }}>
                      {formatMoney(acct.balance || "0")}
                    </TableCell>
                    <TableCell className="text-center">
                      {acct.isActive ? (
                        <Badge variant="secondary" className="text-[10px]" style={{ background: "rgba(34,197,94,0.12)", color: "#22c55e", border: "none" }}>
                          <CheckCircle className="w-3 h-3 mr-1" /> Active
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="text-[10px]" style={{ background: "rgba(239,68,68,0.12)", color: "#ef4444", border: "none" }}>
                          <Archive className="w-3 h-3 mr-1" /> Archived
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={(e) => { e.stopPropagation(); setEditAccount(acct); setDialogOpen(true); }}
                          data-testid={`button-edit-account-${acct.id}`}
                          aria-label="Edit account"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        {acct.isActive && !acct.isSystem && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={(e) => { e.stopPropagation(); archiveMutation.mutate(acct.id); }}
                            data-testid={`button-archive-account-${acct.id}`}
                            aria-label="Archive account"
                          >
                            <Archive className="w-3.5 h-3.5" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function AccountForm({ initial, isPending, onSubmit }: {
  initial: GlAccount | null;
  isPending: boolean;
  onSubmit: (data: any) => void;
}) {
  const [accountNumber, setAccountNumber] = useState(initial?.accountNumber || "");
  const [name, setName] = useState(initial?.name || "");
  const [accountType, setAccountType] = useState<typeof ACCOUNT_TYPES[number]>(initial?.accountType as typeof ACCOUNT_TYPES[number] || "EXPENSE");
  const [normalBalance, setNormalBalance] = useState(initial?.normalBalance || "DEBIT");
  const [description, setDescription] = useState(initial?.description || "");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({ accountNumber, name, accountType, normalBalance, description: description || null });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="accountNumber">Account Number</Label>
          <Input
            id="accountNumber"
            value={accountNumber}
            onChange={(e) => setAccountNumber(e.target.value)}
            placeholder="e.g. 1000"
            required
            data-testid="input-account-number"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="name">Name</Label>
          <Input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Cash - Operating"
            required
            data-testid="input-account-name"
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="accountType">Account Type</Label>
          <Select value={accountType} onValueChange={(v: string) => {
            setAccountType(v as typeof ACCOUNT_TYPES[number]);
            setNormalBalance(["ASSET", "COST_OF_SERVICES", "EXPENSE"].includes(v) ? "DEBIT" : "CREDIT");
          }}>
            <SelectTrigger data-testid="select-account-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ACCOUNT_TYPES.map(t => (
                <SelectItem key={t} value={t}>{formatType(t)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="normalBalance">Normal Balance</Label>
          <Select value={normalBalance} onValueChange={setNormalBalance}>
            <SelectTrigger data-testid="select-normal-balance">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="DEBIT">Debit</SelectItem>
              <SelectItem value="CREDIT">Credit</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="description">Description</Label>
        <Textarea
          id="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Optional description"
          rows={2}
          data-testid="input-account-description"
        />
      </div>
      <Button type="submit" className="w-full text-white" disabled={isPending} data-testid="button-submit-account" style={{ background: "var(--gradient-brand)" }}>
        {isPending ? "Saving..." : initial ? "Update Account" : "Create Account"}
      </Button>
    </form>
  );
}
