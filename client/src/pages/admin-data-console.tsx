import { useState } from "react";
import { useLocation, useParams, Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Users,
  FolderKanban,
  UserCheck,
  Clock,
  FileText,
  List,
  CreditCard,
  Truck,
  Shield,
  Key,
  ChevronRight,
  Plus,
  ArrowLeft,
  Search,
  ChevronLeft,
  Trash2,
  Save,
} from "lucide-react";
import { useDocumentTitle } from "@/lib/use-document-title";
import { PageBreadcrumbs, type PageBreadcrumbItem } from "@/components/page-breadcrumbs";

interface EntityConfig {
  label: string;
  description: string;
  icon: any;
  listColumns: { key: string; label: string }[];
  formFields: { key: string; label: string; type: string; required?: boolean }[];
  editable: boolean;
}

const ENTITY_CONFIGS: Record<string, EntityConfig> = {
  clients: {
    label: "Clients",
    description: "Client companies and contacts",
    icon: Users,
    listColumns: [
      { key: "name", label: "Name" },
      { key: "email", label: "Email" },
      { key: "phone", label: "Phone" },
    ],
    formFields: [
      { key: "name", label: "Name", type: "text", required: true },
      { key: "email", label: "Email", type: "text" },
      { key: "phone", label: "Phone", type: "text" },
      { key: "address", label: "Address", type: "text" },
    ],
    editable: true,
  },
  projects: {
    label: "Projects",
    description: "Projects linked to clients",
    icon: FolderKanban,
    listColumns: [
      { key: "name", label: "Name" },
      { key: "clientId", label: "Client ID" },
      { key: "status", label: "Status" },
    ],
    formFields: [
      { key: "name", label: "Name", type: "text", required: true },
      { key: "clientId", label: "Client ID", type: "text", required: true },
      { key: "description", label: "Description", type: "text" },
      { key: "status", label: "Status", type: "text" },
    ],
    editable: true,
  },
  project_members: {
    label: "Project Members",
    description: "Team member assignments and rates",
    icon: UserCheck,
    listColumns: [
      { key: "projectId", label: "Project ID" },
      { key: "userId", label: "User ID" },
      { key: "hourlyRate", label: "Rate" },
      { key: "role", label: "Role" },
    ],
    formFields: [
      { key: "projectId", label: "Project ID", type: "text", required: true },
      { key: "userId", label: "User ID", type: "text", required: true },
      { key: "hourlyRate", label: "Hourly Rate", type: "text" },
      { key: "costRateHourly", label: "Cost Rate", type: "text" },
      { key: "role", label: "Role", type: "text" },
    ],
    editable: true,
  },
  services: {
    label: "Services",
    description: "Service categories for time tracking",
    icon: FolderKanban,
    listColumns: [
      { key: "name", label: "Name" },
      { key: "description", label: "Description" },
      { key: "defaultRate", label: "Default Rate" },
      { key: "isActive", label: "Active" },
    ],
    formFields: [
      { key: "name", label: "Name", type: "text", required: true },
      { key: "description", label: "Description", type: "text" },
      { key: "defaultRate", label: "Default Rate", type: "text" },
      { key: "isActive", label: "Active (true/false)", type: "text" },
    ],
    editable: true,
  },
  time_entries: {
    label: "Time Entries",
    description: "Logged hours by team members",
    icon: Clock,
    listColumns: [
      { key: "date", label: "Date" },
      { key: "minutes", label: "Minutes" },
      { key: "billable", label: "Billable" },
      { key: "notes", label: "Notes" },
    ],
    formFields: [
      { key: "projectId", label: "Project ID", type: "text", required: true },
      { key: "userId", label: "User ID", type: "text", required: true },
      { key: "date", label: "Date", type: "text", required: true },
      { key: "minutes", label: "Minutes", type: "number", required: true },
      { key: "billable", label: "Billable (true/false)", type: "text" },
      { key: "rate", label: "Rate", type: "text" },
      { key: "serviceId", label: "Service ID", type: "text" },
      { key: "notes", label: "Notes", type: "text" },
    ],
    editable: true,
  },
  invoices: {
    label: "Invoices",
    description: "Client invoices",
    icon: FileText,
    listColumns: [
      { key: "number", label: "Number" },
      { key: "clientId", label: "Client ID" },
      { key: "status", label: "Status" },
      { key: "total", label: "Total" },
    ],
    formFields: [
      { key: "clientId", label: "Client ID", type: "text", required: true },
      { key: "number", label: "Invoice Number", type: "text", required: true },
      { key: "status", label: "Status", type: "text" },
      { key: "issuedDate", label: "Issued Date", type: "text" },
      { key: "dueDate", label: "Due Date", type: "text" },
      { key: "notes", label: "Notes", type: "text" },
    ],
    editable: true,
  },
  invoice_lines: {
    label: "Invoice Lines",
    description: "Line items on invoices",
    icon: List,
    listColumns: [
      { key: "invoiceId", label: "Invoice ID" },
      { key: "description", label: "Description" },
      { key: "quantity", label: "Qty" },
      { key: "amount", label: "Amount" },
    ],
    formFields: [
      { key: "invoiceId", label: "Invoice ID", type: "text", required: true },
      { key: "description", label: "Description", type: "text", required: true },
      { key: "quantity", label: "Quantity", type: "text" },
      { key: "unitRate", label: "Unit Rate", type: "text" },
      { key: "amount", label: "Amount", type: "text" },
    ],
    editable: true,
  },
  payments: {
    label: "Payments",
    description: "Payment records",
    icon: CreditCard,
    listColumns: [
      { key: "invoiceId", label: "Invoice ID" },
      { key: "amount", label: "Amount" },
      { key: "date", label: "Date" },
      { key: "method", label: "Method" },
    ],
    formFields: [
      { key: "invoiceId", label: "Invoice ID", type: "text", required: true },
      { key: "amount", label: "Amount", type: "text", required: true },
      { key: "date", label: "Date", type: "text", required: true },
      { key: "method", label: "Method", type: "text" },
      { key: "notes", label: "Notes", type: "text" },
    ],
    editable: true,
  },
  team_member_payouts: {
    label: "Team Payouts",
    description: "1099 payout records",
    icon: Truck,
    listColumns: [
      { key: "payeeName", label: "Payee" },
      { key: "amount", label: "Amount" },
      { key: "paidAt", label: "Date" },
      { key: "merchant", label: "Merchant" },
    ],
    formFields: [
      { key: "paidAt", label: "Paid At", type: "text", required: true },
      { key: "amount", label: "Amount", type: "text", required: true },
      { key: "payeeName", label: "Payee Name", type: "text", required: true },
      { key: "payeeNormalized", label: "Payee Normalized", type: "text" },
      { key: "merchant", label: "Merchant", type: "text" },
      { key: "description", label: "Description", type: "text" },
      { key: "currency", label: "Currency", type: "text" },
      { key: "source", label: "Source", type: "text" },
    ],
    editable: true,
  },
  audit_logs: {
    label: "Audit Logs",
    description: "System audit trail (view only)",
    icon: Shield,
    listColumns: [
      { key: "action", label: "Action" },
      { key: "entityType", label: "Entity" },
      { key: "entityId", label: "Entity ID" },
      { key: "createdAt", label: "Time" },
    ],
    formFields: [],
    editable: false,
  },
  imported_keys: {
    label: "Imported Keys",
    description: "Import idempotency keys (view only)",
    icon: Key,
    listColumns: [
      { key: "externalKey", label: "External Key" },
      { key: "entityType", label: "Entity Type" },
      { key: "entityId", label: "Entity ID" },
    ],
    formFields: [],
    editable: false,
  },
};

function Breadcrumbs({ entity, recordId }: { entity?: string; recordId?: string }) {
  const [, setLocation] = useLocation();
  const tail: { label: string; href?: string }[] = [];
  if (entity) {
    const config = ENTITY_CONFIGS[entity];
    tail.push({
      label: config?.label || entity,
      href: `/admin/data/${entity}`,
    });
  }
  if (recordId) {
    tail.push({ label: recordId === "new" ? "New Record" : recordId.slice(0, 8) + "..." });
  }

  if (tail.length === 0) {
    return <PageBreadcrumbs page="Data Console" className="mb-4" />;
  }

  const items: PageBreadcrumbItem[] = [
    {
      label: "Data Console",
      onClick: () => setLocation("/admin/data"),
      testId: "link-breadcrumb-data-console",
    },
  ];
  for (let i = 0; i < tail.length - 1; i++) {
    const crumb = tail[i];
    items.push(
      crumb.href
        ? {
            label: crumb.label,
            onClick: () => setLocation(crumb.href!),
            testId: `link-breadcrumb-${i}`,
          }
        : { label: crumb.label },
    );
  }

  return <PageBreadcrumbs page={tail[tail.length - 1].label} items={items} className="mb-4" />;
}

function EntityIndex() {
  const entities = Object.entries(ENTITY_CONFIGS);

  return (
    <div>
      <Breadcrumbs />
      <h1 className="text-2xl font-bold mb-6" style={{ color: "var(--lux-text)" }} data-testid="text-data-console-title">
        Data Console
      </h1>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {entities.map(([key, config]) => (
          <Link key={key} href={`/admin/data/${key}`}>
            <Card className="cursor-pointer border-0 transition-shadow hover:shadow-md" style={{ boxShadow: "var(--lux-card-shadow)", background: "var(--lux-surface)" }} data-testid={`card-entity-${key}`}>
              <CardHeader className="pb-2">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: "rgba(var(--lux-accent-rgb, 139,92,246), 0.1)" }}>
                    <config.icon className="w-4 h-4" style={{ color: "var(--lux-accent)" }} />
                  </div>
                  <CardTitle className="text-base" style={{ color: "var(--lux-text)" }}>{config.label}</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <CardDescription style={{ color: "var(--lux-text-muted)" }}>{config.description}</CardDescription>
                {!config.editable && (
                  <span className="text-xs mt-2 inline-block px-2 py-0.5 rounded-full font-medium" style={{ background: "rgba(var(--lux-accent-rgb, 139,92,246), 0.08)", color: "var(--lux-text-muted)" }}>
                    View Only
                  </span>
                )}
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}

function EntityList({ entity }: { entity: string }) {
  const [, navigate] = useLocation();
  const config = ENTITY_CONFIGS[entity];
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(0);
  const pageSize = 50;

  const { data, isLoading } = useQuery<{ rows: any[]; total: number }>({
    queryKey: ["/api/admin/data", entity, searchQuery, page],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (searchQuery) params.set("query", searchQuery);
      params.set("limit", String(pageSize));
      params.set("offset", String(page * pageSize));
      const res = await fetch(`/api/admin/data/${entity}?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
  });

  if (!config) {
    return (
      <div className="p-6">
        <Breadcrumbs entity={entity} />
        <Card>
          <CardContent className="p-6">
            <p style={{ color: "var(--lux-text)" }} data-testid="text-unsupported-entity">
              Entity "{entity}" is not available in this build. Please check the entity name and try again.
            </p>
            <Link href="/admin/data">
              <Button className="mt-4" data-testid="button-back-to-console">Back to Data Console</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const totalPages = data ? Math.ceil(data.total / pageSize) : 0;

  return (
    <div>
      <Breadcrumbs entity={entity} />
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Link href="/admin/data">
            <Button variant="ghost" size="icon" data-testid="button-back-to-console" aria-label="Back to console">
              <ArrowLeft className="w-4 h-4" />
            </Button>
          </Link>
          <h2 className="text-2xl font-bold" style={{ color: "var(--lux-text)" }} data-testid="text-entity-title">
            {config.label}
          </h2>
        </div>
        {config.editable && (
          <Link href={`/admin/data/${entity}/new`}>
            <Button className="text-white" style={{ background: "var(--gradient-brand)" }} data-testid="button-new-record">
              <Plus className="w-4 h-4 mr-1" /> New
            </Button>
          </Link>
        )}
      </div>

      <div className="flex gap-2 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-2.5 w-4 h-4" style={{ color: "var(--lux-text-muted)" }} />
          <Input
            placeholder="Search..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                setSearchQuery(searchInput);
                setPage(0);
              }
            }}
            className="pl-9"
            data-testid="input-search"
          />
        </div>
        <Button
          variant="outline"
          onClick={() => {
            setSearchQuery(searchInput);
            setPage(0);
          }}
          data-testid="button-search"
        >
          Search
        </Button>
      </div>

      <Card className="border-0" style={{ boxShadow: "var(--lux-card-shadow)", background: "var(--lux-surface)" }}>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center" style={{ color: "var(--lux-text-muted)" }}>Loading...</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow style={{ background: "var(--lux-table-header-bg)" }}>
                  <TableHead className="text-[11px] uppercase tracking-wider font-semibold" style={{ color: "var(--lux-text-muted)" }}>ID</TableHead>
                  {config.listColumns.map((col) => (
                    <TableHead key={col.key} className="text-[11px] uppercase tracking-wider font-semibold" style={{ color: "var(--lux-text-muted)" }}>{col.label}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={config.listColumns.length + 1} className="text-center py-8" style={{ color: "var(--lux-text-muted)" }}>
                      No records found
                    </TableCell>
                  </TableRow>
                ) : (
                  data?.rows.map((row: any) => (
                    <TableRow
                      key={row.id}
                      className="cursor-pointer hover:bg-accent/50"
                      onClick={() => navigate(`/admin/data/${entity}/${row.id}`)}
                      data-testid={`row-${row.id}`}
                    >
                      <TableCell className="font-sans tabular-nums text-xs">{String(row.id).slice(0, 8)}...</TableCell>
                      {config.listColumns.map((col) => (
                        <TableCell key={col.key}>
                          {row[col.key] === true ? "Yes" : row[col.key] === false ? "No" : String(row[col.key] ?? "")}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <Button
            variant="outline"
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            data-testid="button-prev-page"
          >
            <ChevronLeft className="w-4 h-4 mr-1" /> Previous
          </Button>
          <span className="text-sm" style={{ color: "var(--lux-text-muted)" }} data-testid="text-page-info">
            Page {page + 1} of {totalPages} ({data?.total} total)
          </span>
          <Button
            variant="outline"
            disabled={page >= totalPages - 1}
            onClick={() => setPage((p) => p + 1)}
            data-testid="button-next-page"
          >
            Next <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
        </div>
      )}
    </div>
  );
}

function EntityDetail({ entity, id }: { entity: string; id: string }) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const config = ENTITY_CONFIGS[entity];
  const isNew = id === "new";
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [formInit, setFormInit] = useState(false);
  const [showDelete, setShowDelete] = useState(false);

  const { data: record, isLoading } = useQuery({
    queryKey: ["/api/admin/data", entity, id],
    queryFn: async () => {
      if (isNew) return null;
      const res = await fetch(`/api/admin/data/${entity}/${id}`, { credentials: "include" });
      if (!res.ok) throw new Error("Not found");
      return res.json();
    },
    enabled: !isNew,
  });

  if (!isNew && record && !formInit) {
    const initial: Record<string, string> = {};
    for (const field of config?.formFields || []) {
      initial[field.key] = record[field.key] != null ? String(record[field.key]) : "";
    }
    setFormData(initial);
    setFormInit(true);
  }

  if (isNew && !formInit) {
    const initial: Record<string, string> = {};
    for (const field of config?.formFields || []) {
      initial[field.key] = "";
    }
    setFormData(initial);
    setFormInit(true);
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, any> = {};
      for (const field of config?.formFields || []) {
        const val = formData[field.key];
        if (val !== undefined && val !== "") {
          if (field.type === "number") {
            body[field.key] = parseInt(val, 10);
          } else if (val === "true") {
            body[field.key] = true;
          } else if (val === "false") {
            body[field.key] = false;
          } else {
            body[field.key] = val;
          }
        }
      }

      if (isNew) {
        const res = await apiRequest("POST", `/api/admin/data/${entity}`, body);
        return res.json();
      } else {
        const res = await apiRequest("PATCH", `/api/admin/data/${entity}/${id}`, body);
        return res.json();
      }
    },
    onSuccess: (data) => {
      toast({ title: isNew ? "Record created" : "Record updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/data", entity] });
      if (isNew && data?.id) {
        navigate(`/admin/data/${entity}/${data.id}`);
      }
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("DELETE", `/api/admin/data/${entity}/${id}`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Record deleted" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/data", entity] });
      navigate(`/admin/data/${entity}`);
    },
    onError: (err: any) => {
      toast({ title: "Delete failed", description: err.message, variant: "destructive" });
      setShowDelete(false);
    },
  });

  if (!config) {
    return (
      <div className="p-6">
        <Breadcrumbs entity={entity} recordId={id} />
        <p style={{ color: "var(--lux-text)" }}>Entity not available in this build.</p>
      </div>
    );
  }

  const isViewOnly = !config.editable;

  return (
    <div>
      <Breadcrumbs entity={entity} recordId={isNew ? "new" : id} />
      <div className="flex items-center gap-2 mb-4">
        <Link href={`/admin/data/${entity}`}>
          <Button variant="ghost" size="icon" data-testid="button-back-to-list" aria-label="Back to list">
            <ArrowLeft className="w-4 h-4" />
          </Button>
        </Link>
        <h2 className="text-2xl font-bold" style={{ color: "var(--lux-text)" }} data-testid="text-record-title">
          {isNew ? `New ${config.label.replace(/s$/, "")}` : `${config.label} Detail`}
        </h2>
      </div>

      {!isNew && isLoading ? (
        <Card>
          <CardContent className="p-8 text-center" style={{ color: "var(--lux-text-muted)" }}>Loading...</CardContent>
        </Card>
      ) : !isNew && !record ? (
        <Card>
          <CardContent className="p-8 text-center" style={{ color: "var(--lux-text-muted)" }}>Record not found</CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-6 space-y-4">
            {!isNew && (
              <div>
                <Label className="text-xs" style={{ color: "var(--lux-text-muted)" }}>ID</Label>
                <p className="font-sans tabular-nums text-sm" style={{ color: "var(--lux-text)" }} data-testid="text-record-id">{id}</p>
              </div>
            )}

            {isViewOnly ? (
              <div className="space-y-3">
                {record &&
                  Object.entries(record).map(([key, value]) => (
                    <div key={key}>
                      <Label className="text-xs" style={{ color: "var(--lux-text-muted)" }}>{key}</Label>
                      <p className="text-sm" style={{ color: "var(--lux-text)" }}>
                        {typeof value === "object" ? JSON.stringify(value) : String(value ?? "")}
                      </p>
                    </div>
                  ))}
              </div>
            ) : (
              <>
                {config.formFields.map((field) => (
                  <div key={field.key}>
                    <Label htmlFor={`field-${field.key}`} className="text-xs font-medium" style={{ color: "var(--lux-text-muted)" }}>
                      {field.label}
                      {field.required && <span style={{ color: "var(--lux-accent)" }}> *</span>}
                    </Label>
                    <Input
                      id={`field-${field.key}`}
                      value={formData[field.key] || ""}
                      onChange={(e) =>
                        setFormData((prev) => ({ ...prev, [field.key]: e.target.value }))
                      }
                      type={field.type === "number" ? "number" : "text"}
                      style={{ borderColor: "var(--lux-border)", color: "var(--lux-text)" }}
                      data-testid={`input-${field.key}`}
                    />
                  </div>
                ))}

                <div className="flex gap-2 pt-4">
                  <Button
                    className="text-white"
                    style={{ background: "var(--gradient-brand)" }}
                    onClick={() => saveMutation.mutate()}
                    disabled={saveMutation.isPending}
                    data-testid="button-save"
                  >
                    <Save className="w-4 h-4 mr-1" />
                    {saveMutation.isPending ? "Saving..." : isNew ? "Create" : "Save"}
                  </Button>
                  {!isNew && (
                    <Button
                      variant="destructive"
                      onClick={() => setShowDelete(true)}
                      disabled={deleteMutation.isPending}
                      data-testid="button-delete"
                    >
                      <Trash2 className="w-4 h-4 mr-1" />
                      Delete
                    </Button>
                  )}
                  <Link href={`/admin/data/${entity}`}>
                    <Button variant="outline" data-testid="button-cancel">Cancel</Button>
                  </Link>
                </div>
              </>
            )}

            {isViewOnly && (
              <Link href={`/admin/data/${entity}`}>
                <Button variant="outline" data-testid="button-back-to-list">
                  <ArrowLeft className="w-4 h-4 mr-1" /> Back to List
                </Button>
              </Link>
            )}
          </CardContent>
        </Card>
      )}

      <Dialog open={showDelete} onOpenChange={setShowDelete}>
        <DialogContent style={{ background: "var(--lux-surface)", borderColor: "var(--lux-border)" }}>
          <DialogHeader>
            <DialogTitle style={{ color: "var(--lux-text)" }}>Confirm Delete</DialogTitle>
            <DialogDescription style={{ color: "var(--lux-text-muted)" }}>
              Are you sure you want to delete this record? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDelete(false)} style={{ borderColor: "var(--lux-border)", color: "var(--lux-text)" }} data-testid="button-cancel-delete">
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
              data-testid="button-confirm-delete"
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function AdminDataConsolePage() {
  useDocumentTitle("Data Console");
  const { user } = useAuth();
  const params = useParams();
  const entity = params.entity as string | undefined;
  const id = params.id as string | undefined;

  if (user?.role !== "ADMIN") {
    return (
      <div className="p-6" data-testid="text-admin-forbidden">
        <Card>
          <CardContent className="p-8 text-center">
            <p style={{ color: "var(--lux-text)" }}>Access denied. Admin role required.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6">
      {!entity && <EntityIndex />}
      {entity && !id && <EntityList entity={entity} />}
      {entity && id && <EntityDetail entity={entity} id={id} />}
    </div>
  );
}
