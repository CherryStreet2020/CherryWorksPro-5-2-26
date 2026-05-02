import { useState, useRef, useCallback } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Loader2, X, ArrowLeft } from "lucide-react";

interface RateMatrixData {
  project: { id: string; name: string };
  services: { id: string; name: string; defaultRate: string | null }[];
  members: { userId: string; firstName: string | null; lastName: string | null; email: string | null }[];
  cells: { userId: string; serviceId: string; billRate: string | null; costRate: string | null }[];
}

function memberName(m: { firstName: string | null; lastName: string | null; email: string | null }) {
  const full = [m.firstName, m.lastName].filter(Boolean).join(" ");
  return full || m.email || "Unknown";
}

function CellEditor({
  userId,
  serviceId,
  billRate,
  costRate,
  projectId,
}: {
  userId: string;
  serviceId: string;
  billRate: number | null;
  costRate: number | null;
  projectId: string;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [localBill, setLocalBill] = useState(billRate != null ? billRate.toFixed(2) : "");
  const [localCost, setLocalCost] = useState(costRate != null ? costRate.toFixed(2) : "");
  const origBill = useRef(localBill);
  const origCost = useRef(localCost);

  const saveMutation = useMutation({
    mutationFn: (body: { userId: string; serviceId: string; billRate: number | null; costRate: number | null }) =>
      apiRequest("PUT", `/api/admin/rate-matrix/${projectId}/cell`, body),
    onSuccess: () => {
      toast({ title: "Saved", description: "Rate updated successfully.", variant: "default" });
      qc.invalidateQueries({ queryKey: ["/api/admin/rate-matrix", projectId] });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message || "Failed to save rate", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () =>
      apiRequest("DELETE", `/api/admin/rate-matrix/${projectId}/cell`, { userId, serviceId }),
    onSuccess: () => {
      toast({ title: "Removed", description: "Rate removed.", variant: "default" });
      setLocalBill("");
      setLocalCost("");
      origBill.current = "";
      origCost.current = "";
      qc.invalidateQueries({ queryKey: ["/api/admin/rate-matrix", projectId] });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message || "Failed to remove rate", variant: "destructive" });
    },
  });

  const handleBlur = useCallback(() => {
    if (localBill === origBill.current && localCost === origCost.current) return;
    const bVal = localBill.trim() === "" ? null : Number(localBill);
    const cVal = localCost.trim() === "" ? null : Number(localCost);
    if (bVal !== null && (isNaN(bVal) || bVal < 0)) {
      toast({ title: "Invalid", description: "Bill rate must be a non-negative number", variant: "destructive" });
      return;
    }
    if (cVal !== null && (isNaN(cVal) || cVal < 0)) {
      toast({ title: "Invalid", description: "Cost rate must be a non-negative number", variant: "destructive" });
      return;
    }
    origBill.current = localBill;
    origCost.current = localCost;
    saveMutation.mutate({ userId, serviceId, billRate: bVal, costRate: cVal });
  }, [localBill, localCost, userId, serviceId, saveMutation, toast]);

  const handleRemove = () => {
    if (!confirm("Remove this rate assignment?")) return;
    deleteMutation.mutate();
  };

  const isSaving = saveMutation.isPending || deleteMutation.isPending;
  const hasValue = localBill !== "" || localCost !== "";

  return (
    <div className="relative p-2 min-w-[140px]" data-testid={`cell-${userId}-${serviceId}`}>
      {isSaving && (
        <div className="absolute top-1 right-1">
          <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
        </div>
      )}
      {hasValue && (
        <button
          onClick={handleRemove}
          className="absolute top-1 right-1 text-muted-foreground hover:text-destructive"
          data-testid={`remove-${userId}-${serviceId}`}
          title="Remove rate"
        >
          {!isSaving && <X className="h-3 w-3" />}
        </button>
      )}
      <div className="space-y-1">
        <div className="flex items-center gap-1">
          <span className="text-xs text-muted-foreground w-8">Bill:</span>
          <div className="relative flex-1">
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
            <Input
              type="number"
              step="0.01"
              min="0"
              value={localBill}
              onChange={(e) => setLocalBill(e.target.value)}
              onBlur={handleBlur}
              placeholder="—"
              className="h-7 text-xs pl-5 pr-2"
              data-testid={`input-bill-${userId}-${serviceId}`}
            />
          </div>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-xs text-muted-foreground w-8">Cost:</span>
          <div className="relative flex-1">
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
            <Input
              type="number"
              step="0.01"
              min="0"
              value={localCost}
              onChange={(e) => setLocalCost(e.target.value)}
              onBlur={handleBlur}
              placeholder="—"
              className="h-7 text-xs pl-5 pr-2"
              data-testid={`input-cost-${userId}-${serviceId}`}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function RateMatrixPage() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId || "";

  if (user && user.role !== "ADMIN" && user.role !== "MANAGER") {
    toast({ title: "Not authorized", description: "You do not have permission to view this page.", variant: "destructive" });
    setLocation("/dashboard");
    return null;
  }

  const { data, isLoading, error } = useQuery<RateMatrixData>({
    queryKey: ["/api/admin/rate-matrix", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/admin/rate-matrix/${projectId}`, { credentials: "include" });
      if (!res.ok) throw new Error((await res.json()).message || "Failed to load rate matrix");
      return res.json();
    },
    enabled: !!projectId,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64" data-testid="rate-matrix-loading">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-6" data-testid="rate-matrix-error">
        <Card>
          <CardContent className="pt-6">
            <p className="text-destructive">Failed to load rate matrix: {(error as any)?.message || "Unknown error"}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const getCellRate = (userId: string, serviceId: string) => {
    const cell = data.cells.find((c) => c.userId === userId && c.serviceId === serviceId);
    return {
      billRate: cell?.billRate != null ? Number(cell.billRate) : null,
      costRate: cell?.costRate != null ? Number(cell.costRate) : null,
    };
  };

  return (
    <div className="p-6 space-y-6" data-testid="rate-matrix-page">
      <button
        onClick={() => setLocation(`/projects/${projectId}`)}
        className="flex items-center gap-1 text-xs hover:underline w-fit"
        style={{ color: "var(--lux-text-muted)" }}
        data-testid="button-back-project"
      >
        <ArrowLeft className="w-3 h-3" /> Back to {data.project.name}
      </button>
      <PageBreadcrumbs
        page="Rate Matrix"
        showDashboard={false}
        items={[
          { label: "Projects", href: "/projects", testId: "button-crumb-projects" },
          { label: data.project.name, href: `/projects/${projectId}`, testId: "button-crumb-project" },
        ]}
      />
      <div>
        <h1 className="text-2xl font-bold" data-testid="rate-matrix-title">
          Rate Matrix — {data.project.name}
        </h1>
        <p className="text-muted-foreground mt-1" data-testid="rate-matrix-subtitle">
          Set bill and cost rates per service per team member.
        </p>
      </div>

      <Card>
        <CardContent className="pt-6 overflow-x-auto">
          {data.members.length === 0 ? (
            <p className="text-muted-foreground" data-testid="no-members">No team members assigned to this project.</p>
          ) : data.services.length === 0 ? (
            <p className="text-muted-foreground" data-testid="no-services">No services configured for this organization.</p>
          ) : (
            <table className="w-full border-collapse" data-testid="rate-matrix-table">
              <thead>
                <tr>
                  <th className="text-left p-2 border-b font-medium text-sm sticky left-0 bg-background z-10 min-w-[160px]">
                    Team Member
                  </th>
                  {data.services.map((svc) => (
                    <th
                      key={svc.id}
                      className="text-center p-2 border-b font-medium text-sm min-w-[160px]"
                      data-testid={`header-service-${svc.id}`}
                    >
                      <div>{svc.name}</div>
                      {svc.defaultRate && (
                        <div className="text-xs text-muted-foreground font-normal">
                          Default: ${Number(svc.defaultRate).toFixed(2)}
                        </div>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.members.map((m) => (
                  <tr key={m.userId} className="border-b last:border-b-0" data-testid={`row-member-${m.userId}`}>
                    <td className="p-2 font-medium text-sm sticky left-0 bg-background z-10">
                      {memberName(m)}
                    </td>
                    {data.services.map((svc) => {
                      const { billRate, costRate } = getCellRate(m.userId, svc.id);
                      return (
                        <td key={svc.id} className="border-l">
                          <CellEditor
                            userId={m.userId}
                            serviceId={svc.id}
                            billRate={billRate}
                            costRate={costRate}
                            projectId={projectId}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
