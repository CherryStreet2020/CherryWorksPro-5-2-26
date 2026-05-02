import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { ErrorState } from "@/components/shared/error-state";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { PageHelpLink } from "@/components/page-help-link";
import { useAuth } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Plus, FolderKanban, UserPlus, MoreVertical, Pencil, Trash2, UserMinus, Copy, Search, ArrowUpDown, ArrowUp, ArrowDown, ChevronRight, Briefcase, CheckCircle2, X } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { useLocation } from "wouter";
import { useUrlFilterState } from "@/lib/use-url-filter-state";
import type { Client, User, Project, ProjectMember } from "@shared/schema";
import { StatusBadge } from "@/components/shared/status-badge";
import { ActiveFilterBar, type FilterChipDescriptor } from "@/components/active-filter-chip";
import { EmptyState } from "@/components/shared/empty-state";
import { AvatarInitials } from "@/components/shared/avatar-initials";
import { StatCard } from "@/components/shared/stat-card";
import { FormSection } from "@/components/shared/form-section";
import { DateDisplay } from "@/components/shared/date-display";
import { MoneyDisplay } from "@/components/shared/money-display";
import { formatMoney, formatRate } from "@/components/shared/format";
import { useBaseCurrency } from "@/hooks/use-base-currency";
import { useDocumentTitle } from "@/lib/use-document-title";

interface ProjectWithDetails extends Project {
  clientName: string;
  members: Array<ProjectMember & { userName: string }>;
}

type SortField = "name" | "clientName" | "status";
type SortDir = "asc" | "desc";

export default function ProjectsPage() {
  useDocumentTitle("Projects");
  const { user } = useAuth();
  const baseCurrency = useBaseCurrency();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [open, setOpen] = useState(false);
  const [memberOpen, setMemberOpen] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [selectedProject, setSelectedProject] = useState<ProjectWithDetails | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [clientId, setClientId] = useState("");
  const [budgetHours, setBudgetHours] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [pendingMembers, setPendingMembers] = useState<Array<{ userId: string; userName: string; hourlyRate: string; costRate: string }>>([]);
  const [newMemberUserId, setNewMemberUserId] = useState("");
  const [newMemberRate, setNewMemberRate] = useState("");
  const [newMemberCostRate, setNewMemberCostRate] = useState("");
  const [memberId, setMemberId] = useState("");
  const [memberRate, setMemberRate] = useState("");
  const [memberCostRate, setMemberCostRate] = useState("");
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editStatus, setEditStatus] = useState("");

  const [filters, setFilter] = useUrlFilterState({
    q: "",
    status: "ALL",
    client: "ALL",
    sort: "name",
    dir: "asc",
  });
  const [hubFilter, setHubFilter] = useState<{ label: string } | null>(null);
  const searchTerm = filters.q;
  const statusFilter = filters.status;
  const clientFilter = filters.client;
  const sortField = filters.sort as SortField;
  const sortDir = filters.dir as SortDir;
  const setSearchTerm = (v: string) => setFilter("q", v, { replace: true });
  const setStatusFilter = (v: string) => setFilter("status", v);
  const setClientFilter = (v: string) => setFilter("client", v);

  const isAdmin = user?.role === "ADMIN";
  const canManage = user?.role === "ADMIN" || user?.role === "MANAGER";

  const { data: projects, isLoading, isError, error: projectsQueryError, refetch } = useQuery<ProjectWithDetails[]>({
    queryKey: ["/api/projects"],
  });
  const { data: clientsList } = useQuery<Client[]>({
    queryKey: ["/api/clients"],
    enabled: canManage,
  });
  const { data: teamMembers } = useQuery<User[]>({
    queryKey: ["/api/users/team-members"],
    enabled: canManage,
  });

  const statusCounts = useMemo(() => {
    if (!projects) return { ALL: 0, ACTIVE: 0, COMPLETED: 0, ON_HOLD: 0, ARCHIVED: 0 };
    const counts = { ALL: projects.length, ACTIVE: 0, COMPLETED: 0, ON_HOLD: 0, ARCHIVED: 0 };
    for (const p of projects) {
      if (p.status in counts) {
        counts[p.status as keyof typeof counts]++;
      }
    }
    return counts;
  }, [projects]);

  const totalAssignedMembers = useMemo(() => {
    if (!projects) return 0;
    let count = 0;
    for (const p of projects) {
      count += (p.members || []).length;
    }
    return count;
  }, [projects]);

  const avgRate = useMemo(() => {
    if (!projects) return 0;
    let total = 0;
    let count = 0;
    for (const p of projects) {
      for (const m of p.members || []) {
        total += Number(m.hourlyRate) || 0;
        count++;
      }
    }
    return count > 0 ? total / count : 0;
  }, [projects]);

  const filteredProjects = useMemo(() => {
    if (!projects) return [];
    let filtered = [...projects];

    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(
        (p) =>
          p.name.toLowerCase().includes(term) ||
          p.clientName.toLowerCase().includes(term)
      );
    }

    if (statusFilter !== "ALL") {
      filtered = filtered.filter((p) => p.status === statusFilter);
    }

    if (clientFilter !== "ALL") {
      filtered = filtered.filter((p) => p.clientId === clientFilter);
    }

    filtered.sort((a, b) => {
      let aVal = "";
      let bVal = "";
      if (sortField === "name") {
        aVal = a.name.toLowerCase();
        bVal = b.name.toLowerCase();
      } else if (sortField === "clientName") {
        aVal = a.clientName.toLowerCase();
        bVal = b.clientName.toLowerCase();
      } else if (sortField === "status") {
        aVal = a.status;
        bVal = b.status;
      }
      if (aVal < bVal) return sortDir === "asc" ? -1 : 1;
      if (aVal > bVal) return sortDir === "asc" ? 1 : -1;
      return 0;
    });

    return filtered;
  }, [projects, searchTerm, statusFilter, clientFilter, sortField, sortDir]);

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setFilter("dir", sortDir === "asc" ? "desc" : "asc");
    } else {
      setFilter("sort", field);
      setFilter("dir", "asc");
    }
  }

  function SortIcon({ field }: { field: SortField }) {
    if (sortField !== field) return <ArrowUpDown className="w-3.5 h-3.5 ml-1 opacity-40" />;
    return sortDir === "asc"
      ? <ArrowUp className="w-3.5 h-3.5 ml-1" />
      : <ArrowDown className="w-3.5 h-3.5 ml-1" />;
  }

  function addPendingMember() {
    if (!newMemberUserId || !newMemberRate) return;
    const member = teamMembers?.find(c => c.id === newMemberUserId);
    if (!member) return;
    if (pendingMembers.some(m => m.userId === newMemberUserId)) {
      toast({ title: "Already added", variant: "destructive" });
      return;
    }
    setPendingMembers(prev => [...prev, {
      userId: newMemberUserId,
      userName: member.name,
      hourlyRate: newMemberRate,
      costRate: newMemberCostRate || "0",
    }]);
    setNewMemberUserId("");
    setNewMemberRate("");
    setNewMemberCostRate("");
  }

  function removePendingMember(userId: string) {
    setPendingMembers(prev => prev.filter(m => m.userId !== userId));
  }

  function resetCreateForm() {
    setName(""); setDescription(""); setClientId("");
    setBudgetHours(""); setStartDate(""); setEndDate("");
    setPendingMembers([]); setNewMemberUserId(""); setNewMemberRate(""); setNewMemberCostRate("");
  }

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/projects", {
        name,
        description: description || null,
        clientId,
        budgetHours: budgetHours ? Number(budgetHours) : null,
        startDate: startDate || null,
        endDate: endDate || null,
      });
      const project = await res.json();

      for (const member of pendingMembers) {
        await apiRequest("POST", `/api/projects/${project.id}/members`, {
          userId: member.userId,
          hourlyRate: member.hourlyRate,
          costRateHourly: member.costRate || "0",
        });
      }

      return project;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      setOpen(false);
      resetCreateForm();
      toast({ title: pendingMembers.length > 0 ? "Project created with team members" : "Project created" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const addMemberMutation = useMutation({
    mutationFn: async (projectId: string) => {
      await apiRequest("POST", `/api/projects/${projectId}/members`, {
        userId: memberId,
        hourlyRate: memberRate,
        costRateHourly: memberCostRate || "0",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      setMemberOpen(null);
      setMemberId("");
      setMemberRate("");
      setMemberCostRate("");
      toast({ title: "Team member assigned" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!selectedProject) return;
      await apiRequest("PATCH", `/api/projects/${selectedProject.id}`, {
        name: editName,
        description: editDescription || null,
        status: editStatus,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      setEditOpen(false);
      toast({ title: "Project updated" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!selectedProject) return;
      await apiRequest("DELETE", `/api/projects/${selectedProject.id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      setDeleteOpen(false);
      toast({ title: "Project deleted" });
    },
    onError: (err: Error) => {
      toast({ title: "Cannot delete", description: err.message, variant: "destructive" });
    },
  });

  const removeMemberMutation = useMutation({
    mutationFn: async ({ projectId, memberId: mId }: { projectId: string; memberId: string }) => {
      await apiRequest("DELETE", `/api/projects/${projectId}/members/${mId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      toast({ title: "Member removed" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const duplicateMutation = useMutation({
    mutationFn: async (projectId: string) => {
      await apiRequest("POST", `/api/projects/${projectId}/duplicate`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      toast({ title: "Project duplicated" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  function openEdit(project: ProjectWithDetails) {
    setSelectedProject(project);
    setEditName(project.name);
    setEditDescription(project.description || "");
    setEditStatus(project.status);
    setEditOpen(true);
  }

  function openDelete(project: ProjectWithDetails) {
    setSelectedProject(project);
    setDeleteOpen(true);
  }

  if (isLoading) {
    return (
      <div className="px-6 lg:px-8 xl:px-10 py-6 space-y-6">
        <div className="flex items-center gap-4"><Skeleton className="h-12 w-12 rounded-xl" /><div><Skeleton className="h-7 w-40 rounded-lg" /><Skeleton className="h-4 w-56 rounded-md mt-1.5" /></div></div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">{[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
        <Skeleton className="h-12 rounded-xl" />
        <Skeleton className="h-96 rounded-xl" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="px-6 lg:px-8 xl:px-10 py-6">
        <ErrorState title="Failed to load projects" description="We couldn't load project data. Please try again." onRetry={refetch} error={projectsQueryError as Error} showDashboardLink />
      </div>
    );
  }

  const statusButtons: { key: string; label: string }[] = [
    { key: "ALL", label: "All" },
    { key: "ACTIVE", label: "Active" },
    { key: "COMPLETED", label: "Completed" },
    { key: "ON_HOLD", label: "On Hold" },
    { key: "ARCHIVED", label: "Archived" },
  ];

  return (
    <div className="px-6 lg:px-8 xl:px-10 py-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4">
          <div className="relative">
            <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: "linear-gradient(135deg, rgba(var(--lux-accent-rgb),0.15) 0%, rgba(var(--lux-accent-rgb),0.05) 100%)" }}>
              <FolderKanban className="w-6 h-6" style={{ color: "var(--lux-accent)" }} />
            </div>
          </div>
          <div>
            <div className="flex items-center gap-3">
              <h1
                className="text-2xl font-bold tracking-tight"
                style={{ color: "var(--lux-text)" }}
                data-testid="text-projects-title"
              >
                Projects
              </h1>
              <PageHelpLink />
            </div>
            <p className="text-sm mt-0.5" style={{ color: "var(--lux-text-muted)" }}>
              Manage projects and team member assignments
            </p>
          </div>
        </div>
        {canManage && (
          <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetCreateForm(); }}>
            <DialogTrigger asChild>
              <Button
                data-testid="button-add-project"
                style={{ background: "var(--gradient-brand)" }}
                className="text-white"
              >
                <Plus className="w-4 h-4 mr-2" />
                New Project
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto" style={{ background: "var(--lux-surface)", borderColor: "var(--lux-border)" }}>
              <DialogHeader>
                <DialogTitle style={{ color: "var(--lux-text)" }}>New Project</DialogTitle>
              </DialogHeader>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  createMutation.mutate();
                }}
                className="space-y-5"
              >
                <FormSection title="Project Details">
                  <div className="space-y-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium">Project Name *</Label>
                      <Input value={name} onChange={(e) => setName(e.target.value)} required data-testid="input-project-name" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium">Client *</Label>
                      <Select value={clientId} onValueChange={setClientId}>
                        <SelectTrigger data-testid="select-project-client">
                          <SelectValue placeholder="Select client" />
                        </SelectTrigger>
                        <SelectContent>
                          {clientsList?.map((c) => (
                            <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium">Description</Label>
                      <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} data-testid="input-project-description" />
                    </div>
                  </div>
                </FormSection>

                <FormSection title="Schedule & Budget" description="Set timeline and hour budget for tracking">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium">Start Date</Label>
                      <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} data-testid="input-project-start-date" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium">End Date</Label>
                      <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} data-testid="input-project-end-date" />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">Budget Hours</Label>
                    <Input type="number" min="0" step="0.5" value={budgetHours} onChange={(e) => setBudgetHours(e.target.value)} placeholder="e.g. 400" data-testid="input-project-budget-hours" />
                    <p className="text-[11px]" style={{ color: "var(--lux-text-muted)" }}>Total hours allocated. Leave blank for unlimited.</p>
                  </div>
                </FormSection>

                <FormSection title="Team Members" description="Assign team members and set billing rates">
                  <div className="flex items-end gap-2">
                    <div className="flex-1 space-y-1.5">
                      <Label className="text-xs font-medium">Team Member</Label>
                      <Select value={newMemberUserId} onValueChange={setNewMemberUserId}>
                        <SelectTrigger data-testid="select-pending-member">
                          <SelectValue placeholder="Select team member" />
                        </SelectTrigger>
                        <SelectContent>
                          {teamMembers?.filter(c => !pendingMembers.some(m => m.userId === c.id)).map(c => (
                            <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="w-28 space-y-1.5">
                      <Label className="text-xs font-medium">Bill Rate</Label>
                      <Input type="number" min="0" step="0.01" value={newMemberRate} onChange={(e) => setNewMemberRate(e.target.value)} placeholder="150.00" data-testid="input-pending-member-rate" />
                    </div>
                    <div className="w-28 space-y-1.5">
                      <Label className="text-xs font-medium">Cost Rate</Label>
                      <Input type="number" min="0" step="0.01" value={newMemberCostRate} onChange={(e) => setNewMemberCostRate(e.target.value)} placeholder="75.00" data-testid="input-pending-member-cost-rate" />
                    </div>
                    <Button type="button" variant="outline" size="sm" onClick={addPendingMember} disabled={!newMemberUserId || !newMemberRate} data-testid="button-add-pending-member">
                      <Plus className="w-4 h-4" />
                    </Button>
                  </div>

                  {pendingMembers.length > 0 && (
                    <div className="space-y-2 mt-3">
                      {pendingMembers.map(m => (
                        <div key={m.userId} className="flex items-center justify-between px-3 py-2 rounded-md" style={{ background: "var(--lux-surface-alt)" }} data-testid={`pending-member-${m.userId}`}>
                          <div className="flex items-center gap-2">
                            <AvatarInitials name={m.userName} size="xs" />
                            <span className="text-sm font-medium" style={{ color: "var(--lux-text)" }}>{m.userName}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm tabular-nums" style={{ color: "var(--lux-text-muted)" }}>{formatRate(m.hourlyRate)} bill · {formatRate(m.costRate)} cost</span>
                            <Button type="button" variant="ghost" size="icon" className="h-6 w-6" onClick={() => removePendingMember(m.userId)} data-testid={`button-remove-pending-member-${m.userId}`} aria-label="Remove member">
                              <X className="w-3 h-3" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {pendingMembers.length === 0 && (
                    <p className="text-xs text-center py-2" style={{ color: "var(--lux-text-muted)" }}>
                      No members added yet. You can also assign members later.
                    </p>
                  )}
                </FormSection>

                <div className="flex justify-end gap-2 pt-2">
                  <Button type="button" variant="ghost" onClick={() => setOpen(false)} data-testid="button-cancel-project">Cancel</Button>
                  <Button
                    type="submit"
                    className="text-white"
                    disabled={createMutation.isPending || !name || !clientId}
                    data-testid="button-submit-project"
                    style={{ background: "var(--gradient-brand)" }}
                  >
                    {createMutation.isPending ? "Creating..." : "Create Project"}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={FolderKanban}
          label="Total Projects"
          value={String(statusCounts.ALL)}
          testId="stat-total-projects"
        />
        <StatCard
          icon={Briefcase}
          label="Active"
          value={String(statusCounts.ACTIVE)}
          color="#22c55e"
          testId="stat-active-projects"
        />
        <StatCard
          icon={CheckCircle2}
          label="Completed"
          value={String(statusCounts.COMPLETED)}
          color="#3b82f6"
          testId="stat-completed-projects"
        />
        <StatCard
          icon={UserPlus}
          label="Avg Hourly Rate"
          value={formatMoney(avgRate, baseCurrency)}
          subValue={`${totalAssignedMembers} assigned member${totalAssignedMembers !== 1 ? "s" : ""}`}
          testId="stat-avg-rate"
        />
      </div>

      <Card className="border-0 p-4 space-y-4" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }}>
        {(() => {
          const statusLabels: Record<string, string> = {
            ACTIVE: "Active",
            COMPLETED: "Completed",
            ON_HOLD: "On Hold",
            ARCHIVED: "Archived",
          };
          const chips: FilterChipDescriptor[] = [];
          if (statusFilter !== "ALL") {
            chips.push({
              id: "hub-filter",
              label: hubFilter?.label || `Status: ${statusLabels[statusFilter] || statusFilter}`,
              onClear: () => { setStatusFilter("ALL"); setHubFilter(null); },
            });
          }
          if (searchTerm) {
            chips.push({
              id: "search",
              label: `Search: "${searchTerm}"`,
              onClear: () => setSearchTerm(""),
            });
          }
          if (clientFilter !== "ALL") {
            const clientName = clientsList?.find((c) => c.id === clientFilter)?.name || "Selected client";
            chips.push({
              id: "client",
              label: `Client: ${clientName}`,
              onClear: () => setClientFilter("ALL"),
            });
          }
          return <ActiveFilterBar chips={chips} />;
        })()}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "var(--lux-text-muted)" }} />
            <Input
              placeholder="Search projects or clients..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9"
              data-testid="input-search-projects"
            />
          </div>
          <Select value={clientFilter} onValueChange={setClientFilter}>
            <SelectTrigger className="w-[180px]" data-testid="select-client-filter">
              <SelectValue placeholder="All Clients" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Clients</SelectItem>
              {clientsList?.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {statusButtons.map((sb) => (
            <Button
              key={sb.key}
              variant={statusFilter === sb.key ? "default" : "outline"}
              size="sm"
              onClick={() => { setStatusFilter(sb.key); setHubFilter(null); }}
              data-testid={`button-filter-${sb.key.toLowerCase()}`}
              style={statusFilter === sb.key ? { background: "var(--gradient-brand)" } : { borderColor: "var(--lux-border)", color: "var(--lux-text)" }}
              className={statusFilter === sb.key ? "text-white" : ""}
            >
              {sb.label}
              <span className="ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-black/10 dark:bg-white/10">
                {statusCounts[sb.key as keyof typeof statusCounts] ?? 0}
              </span>
            </Button>
          ))}
        </div>
      </Card>

      {!filteredProjects.length ? (
        <Card className="border-0" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }}>
          <EmptyState
            icon={FolderKanban}
            title={projects?.length ? "No projects match your filters" : "No projects yet"}
            description={projects?.length ? "Try adjusting your search or filters" : "Create a client first, then add projects"}
          />
        </Card>
      ) : (
        <Card className="border-0 overflow-visible" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }}>
          <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow style={{ background: "var(--lux-table-header-bg)" }}>
                <TableHead className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>
                  <button
                    className="flex items-center font-semibold cursor-pointer"
                    onClick={() => toggleSort("name")}
                    data-testid="button-sort-name"
                  >
                    Name <SortIcon field="name" />
                  </button>
                </TableHead>
                <TableHead className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>
                  <button
                    className="flex items-center font-semibold cursor-pointer"
                    onClick={() => toggleSort("clientName")}
                    data-testid="button-sort-client"
                  >
                    Client <SortIcon field="clientName" />
                  </button>
                </TableHead>
                <TableHead className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>
                  <button
                    className="flex items-center font-semibold cursor-pointer"
                    onClick={() => toggleSort("status")}
                    data-testid="button-sort-status"
                  >
                    Status <SortIcon field="status" />
                  </button>
                </TableHead>
                <TableHead className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>Members</TableHead>
                {canManage && <TableHead className="text-right text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--lux-text-muted)" }}>Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredProjects.map((project) => {
                return (
                  <TableRow
                    key={project.id}
                    data-testid={`row-project-${project.id}`}
                    className="hover-elevate cursor-pointer transition-colors"
                    style={{ borderColor: "var(--lux-border)" }}
                    onClick={() => navigate(`/projects/${project.id}`)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.target !== e.currentTarget) return; if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate(`/projects/${project.id}`); } }}
                  >
                    <TableCell>
                      <div className="min-w-0">
                        <span className="font-medium" style={{ color: "var(--lux-text)" }} data-testid={`text-project-name-${project.id}`}>
                          {project.name}
                        </span>
                        {project.description && (
                          <p className="text-xs mt-0.5 truncate max-w-[300px]" style={{ color: "var(--lux-text-muted)" }}>
                            {project.description}
                          </p>
                        )}
                        {(project.startDate || project.endDate) && (
                          <div className="flex items-center gap-1 mt-0.5">
                            {project.startDate && <DateDisplay value={project.startDate} />}
                            {project.startDate && project.endDate && <span className="text-xs" style={{ color: "var(--lux-text-muted)" }}>&ndash;</span>}
                            {project.endDate && <DateDisplay value={project.endDate} />}
                          </div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <span style={{ color: "var(--lux-text-secondary)" }} data-testid={`text-project-client-${project.id}`}>
                        {project.clientName}
                      </span>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={project.status} />
                    </TableCell>
                    <TableCell>
                      {project.members?.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5">
                          {project.members.map((m) => (
                            <div
                              key={m.id}
                              className="flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full group"
                              style={{ background: "var(--color-accent-soft)", color: "var(--color-accent)" }}
                              data-testid={`badge-member-${m.id}`}
                            >
                              <AvatarInitials name={m.userName} size="xs" />
                              <span className="font-medium">{m.userName}</span>
                              <MoneyDisplay currency={baseCurrency} value={Number(m.hourlyRate)} size="xs" />
                              <span className="text-[10px]" style={{ color: "var(--lux-text-muted)" }}>/hr</span>
                              {canManage && (
                                <button
                                  onClick={() => removeMemberMutation.mutate({ projectId: project.id, memberId: m.id })}
                                  className="ml-0.5 invisible group-hover:visible"
                                  title="Remove member"
                                  data-testid={`button-remove-member-${m.id}`}
                                >
                                  <UserMinus className="w-3 h-3" />
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <span className="text-xs" style={{ color: "var(--lux-text-muted)" }}>No members</span>
                      )}
                    </TableCell>
                    {canManage && (
                      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1">
                          <Dialog
                            open={memberOpen === project.id}
                            onOpenChange={(v) => setMemberOpen(v ? project.id : null)}
                          >
                            <DialogTrigger asChild>
                              <Button variant="outline" size="sm" data-testid={`button-assign-${project.id}`}>
                                <UserPlus className="w-3.5 h-3.5 mr-1.5" />
                                Assign
                              </Button>
                            </DialogTrigger>
                            <DialogContent style={{ background: "var(--lux-surface)", borderColor: "var(--lux-border)" }}>
                              <DialogHeader>
                                <DialogTitle style={{ color: "var(--lux-text)" }}>Assign Team Member to {project.name}</DialogTitle>
                              </DialogHeader>
                              <form
                                onSubmit={(e) => {
                                  e.preventDefault();
                                  addMemberMutation.mutate(project.id);
                                }}
                                className="space-y-4"
                              >
                                <FormSection title="Assignment Details">
                                  <div className="space-y-4">
                                    <div className="space-y-2">
                                      <Label>Team Member</Label>
                                      <Select value={memberId} onValueChange={setMemberId}>
                                        <SelectTrigger data-testid="select-team-member">
                                          <SelectValue placeholder="Select team member" />
                                        </SelectTrigger>
                                        <SelectContent>
                                          {teamMembers?.map((c) => (
                                            <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                                          ))}
                                        </SelectContent>
                                      </Select>
                                    </div>
                                    <div className="space-y-2">
                                      <Label>Bill Rate ($/hr) — what client pays</Label>
                                      <Input
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        value={memberRate}
                                        onChange={(e) => setMemberRate(e.target.value)}
                                        required
                                        data-testid="input-hourly-rate"
                                      />
                                    </div>
                                    <div className="space-y-2">
                                      <Label>Cost Rate ($/hr) — what you pay team member</Label>
                                      <Input
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        value={memberCostRate}
                                        onChange={(e) => setMemberCostRate(e.target.value)}
                                        data-testid="input-cost-rate"
                                      />
                                    </div>
                                  </div>
                                </FormSection>
                                <Button
                                  type="submit"
                                  className="w-full text-white"
                                  disabled={addMemberMutation.isPending || !memberId}
                                  data-testid="button-submit-member"
                                  style={{ background: "var(--gradient-brand)" }}
                                >
                                  {addMemberMutation.isPending ? "Assigning..." : "Assign"}
                                </Button>
                              </form>
                            </DialogContent>
                          </Dialog>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" data-testid={`button-project-menu-${project.id}`} aria-label="Project actions">
                                <MoreVertical className="w-4 h-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => openEdit(project)} data-testid={`button-edit-project-${project.id}`}>
                                <Pencil className="w-3.5 h-3.5 mr-2" /> Edit
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => duplicateMutation.mutate(project.id)}
                                data-testid={`button-duplicate-project-${project.id}`}
                              >
                                <Copy className="w-3.5 h-3.5 mr-2" /> Duplicate
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => openDelete(project)} className="text-red-600" data-testid={`button-delete-project-${project.id}`}>
                                <Trash2 className="w-3.5 h-3.5 mr-2" /> Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                          <ChevronRight size={16} style={{ color: "var(--lux-text-muted)" }} />
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          </div>
        </Card>
      )}

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent style={{ background: "var(--lux-surface)", borderColor: "var(--lux-border)" }}>
          <DialogHeader>
            <DialogTitle style={{ color: "var(--lux-text)" }}>Edit Project</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              updateMutation.mutate();
            }}
            className="space-y-4"
          >
            <FormSection title="Project Details">
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Name *</Label>
                  <Input value={editName} onChange={(e) => setEditName(e.target.value)} required data-testid="input-edit-project-name" />
                </div>
                <div className="space-y-2">
                  <Label>Description</Label>
                  <Input value={editDescription} onChange={(e) => setEditDescription(e.target.value)} data-testid="input-edit-project-description" />
                </div>
              </div>
            </FormSection>
            <FormSection title="Status">
              <div className="space-y-2">
                <Select value={editStatus} onValueChange={setEditStatus}>
                  <SelectTrigger data-testid="select-edit-project-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ACTIVE">Active</SelectItem>
                    <SelectItem value="COMPLETED">Completed</SelectItem>
                    <SelectItem value="ON_HOLD">On Hold</SelectItem>
                    <SelectItem value="ARCHIVED">Archived</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </FormSection>
            <Button
              type="submit"
              className="w-full text-white"
              disabled={updateMutation.isPending}
              data-testid="button-submit-edit-project"
              style={{ background: "var(--gradient-brand)" }}
            >
              {updateMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent style={{ background: "var(--lux-surface)", borderColor: "var(--lux-border)" }}>
          <AlertDialogHeader>
            <AlertDialogTitle style={{ color: "var(--lux-text)" }}>Delete Project</AlertDialogTitle>
            <AlertDialogDescription style={{ color: "var(--lux-text-muted)" }}>
              Are you sure you want to delete "{selectedProject?.name}"? The project must have no linked time entries.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-project">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteMutation.mutate()}
              className="bg-red-600 hover:bg-red-700"
              data-testid="button-confirm-delete-project"
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
