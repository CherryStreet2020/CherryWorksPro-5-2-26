import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { PageHelpLink } from "@/components/page-help-link";
import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
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
} from "@/components/ui/dialog";
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
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft,
  Pencil,
  MoreVertical,
  Copy,
  Archive,
  Clock,
  DollarSign,
  Calendar,
  TrendingUp,
  FileText,
  BarChart3,
  Users,
  Briefcase,
  AlertTriangle,
  Search,
  Plus,
  Trash2,
  UserPlus,
  Grid3X3,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/shared/status-badge";
import { StatCard } from "@/components/shared/stat-card";
import { EmptyState } from "@/components/shared/empty-state";
import { DateDisplay } from "@/components/shared/date-display";
import { MoneyDisplay } from "@/components/shared/money-display";
import { FormSection } from "@/components/shared/form-section";
import { formatMoney, formatDate, formatHoursMinutes, formatTime12h, formatPercent, formatHours, formatRate } from "@/components/shared/format";
import { CostRateInlineEditor } from "@/components/shared/cost-rate-inline-editor";
import { useBaseCurrency } from "@/hooks/use-base-currency";
import { getProjectColor } from "@/components/time/utils";
import type { ProjectOption, ServiceOption } from "@/components/time/utils";
import TimeEntryDialog from "@/components/time/time-entry-dialog";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import { useDocumentTitle } from "@/lib/use-document-title";

interface ProjectDetailData {
  project: {
    id: string;
    name: string;
    description: string | null;
    status: string;
    clientId: string;
    clientName: string;
    budgetHours: string | null;
    startDate: string | null;
    endDate: string | null;
    createdAt: string;
  };
  members: Array<{
    id: string;
    userId: string;
    userName: string;
    hourlyRate: string;
    costRateHourly?: string;
    role: string | null;
  }>;
  stats: {
    totalHoursLogged: number;
    billableHours: number;
    nonBillableHours: number;
    unbilledHours: number;
    unbilledAmount: number;
    totalInvoiced: number;
    totalPaid: number;
    totalOutstanding: number;
    budgetHours: number | null;
    budgetUsedPercent: number | null;
    budgetRemaining: number | null;
    daysUntilDue: number | null;
    overBudgetHours: number;
  };
  hoursByMember: Array<{
    userId: string;
    userName: string;
    billableHours: number;
    nonBillableHours: number;
    totalHours: number;
  }>;
  recentTimeEntries: Array<{
    id: string;
    date: string;
    startTime: string | null;
    endTime: string | null;
    minutes: number;
    userId: string;
    userName: string;
    serviceName: string;
    notes: string | null;
    billable: boolean;
    invoiced: boolean;
    rate: string;
  }>;
  invoices: Array<{
    id: string;
    number: string;
    issuedDate: string;
    total: string;
    paidAmount: string;
    status: string;
    clientName: string;
  }>;
  estimates: Array<{
    id: string;
    number: string;
    issuedDate: string;
    total: string;
    status: string;
  }>;
  services: Array<{
    id: string;
    name: string;
    hoursLogged: number;
  }>;
}

const MEMBER_COLORS = [
  "#cf3339", "#3b82f6", "#22c55e", "#f59e0b",
  "#8b5cf6", "#14b8a6", "#ec4899", "#f97316",
];

export default function ProjectDetailPage({ id }: { id: string }) {
  useDocumentTitle("Project Details");
  const { toast } = useToast();
  const baseCurrency = useBaseCurrency();
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN" || user?.role === "MANAGER";
  const [editOpen, setEditOpen] = useState(false);
  const [metricsTab, setMetricsTab] = useState<"hours" | "profitability">("hours");
  const [bottomTab, setBottomTab] = useState("time");
  const [searchTerm, setSearchTerm] = useState("");
  const [timeDialogOpen, setTimeDialogOpen] = useState(false);
  const [showAssignService, setShowAssignService] = useState(false);
  const [assignServiceId, setAssignServiceId] = useState("");
  const [showAddMember, setShowAddMember] = useState(false);
  const [addMemberUserId, setAddMemberUserId] = useState("");
  const [addMemberBillRate, setAddMemberBillRate] = useState("");
  const [addMemberCostRate, setAddMemberCostRate] = useState("");

  const assignServiceMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", `/api/projects/${id}/services`, { serviceId: assignServiceId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", id] });
      setAssignServiceId("");
      setShowAssignService(false);
      toast({ title: "Service assigned to project" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const removeServiceMutation = useMutation({
    mutationFn: async (assignmentId: string) => {
      await apiRequest("DELETE", `/api/projects/${id}/services/${assignmentId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", id] });
      toast({ title: "Service removed from project" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const { data, isLoading, error } = useQuery<ProjectDetailData>({
    queryKey: ["/api/projects", id],
    enabled: !!id,
    queryFn: async () => {
      const res = await fetch(`/api/projects/${id}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load project");
      return res.json();
    },
  });

  const { data: services } = useQuery<ServiceOption[]>({
    queryKey: ["/api/services"],
  });

  const { data: membersData, isLoading: membersLoading, error: membersError } = useQuery<any[]>({
    queryKey: ["/api/projects", id, "members"],
    enabled: !!id && bottomTab === "members",
    queryFn: async () => {
      const res = await fetch(`/api/projects/${id}/members`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load members");
      return res.json();
    },
  });

  const { data: teamList } = useQuery<any[]>({
    queryKey: ["/api/team"],
    enabled: showAddMember,
  });

  const addMemberMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", `/api/projects/${id}/members`, {
        userId: addMemberUserId,
        hourlyRate: parseFloat(addMemberBillRate) || 0,
        costRateHourly: parseFloat(addMemberCostRate) || 0,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", id, "members"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", id] });
      setShowAddMember(false);
      setAddMemberUserId("");
      setAddMemberBillRate("");
      setAddMemberCostRate("");
      toast({ title: "Member added to project" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const removeMemberMutation = useMutation({
    mutationFn: async (memberId: string) => {
      await apiRequest("DELETE", `/api/projects/${id}/members/${memberId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", id, "members"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", id] });
      toast({ title: "Member removed from project" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const duplicateMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/projects/${id}/duplicate`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      toast({ title: "Project duplicated" });
    },
  });

  const archiveMutation = useMutation({
    mutationFn: () => apiRequest("PATCH", `/api/projects/${id}`, { status: "ARCHIVED" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", id] });
      toast({ title: "Project archived" });
    },
  });

  if (isLoading) {
    return (
      <div className="px-6 lg:px-8 xl:px-10 py-6 space-y-6" data-testid="project-detail-loading">
        <Skeleton className="h-6 w-32" />
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          <div className="lg:col-span-2"><Skeleton className="h-64 w-full rounded-lg" /></div>
          <div className="lg:col-span-3"><Skeleton className="h-64 w-full rounded-lg" /></div>
        </div>
        <Skeleton className="h-80 w-full rounded-lg" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="px-6 lg:px-8 xl:px-10 py-6">
        <Button variant="ghost" onClick={() => navigate("/projects")} data-testid="link-back-projects">
          <ArrowLeft size={16} className="mr-2" /> Projects
        </Button>
        <EmptyState icon={AlertTriangle} title="Project not found" description="This project could not be loaded." />
      </div>
    );
  }

  const { project, members, stats, hoursByMember, recentTimeEntries, invoices: projectInvoices, estimates: projectEstimates, services: projectServices } = data;
  const assignedServices = (data as any).assignedServices || [];
  const projectColor = getProjectColor(project.id);

  const dialogProjects: ProjectOption[] = [{
    id: project.id,
    name: project.name,
    clientName: project.clientName || "",
    rate: members?.[0]?.hourlyRate || "0",
  }];

  const totalServiceHours = projectServices.reduce((s, svc) => s + svc.hoursLogged, 0);

  const filteredEntries = searchTerm
    ? recentTimeEntries.filter(e =>
        (e.userName || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
        (e.serviceName || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
        (e.notes || "").toLowerCase().includes(searchTerm.toLowerCase())
      )
    : recentTimeEntries;

  const costByMember = hoursByMember.map(h => {
    const m = members.find(mm => mm.userId === h.userId);
    const costRate = m?.costRateHourly ? Number(m.costRateHourly) : 0;
    return { ...h, cost: h.totalHours * costRate };
  });
  const totalCost = costByMember.reduce((s, c) => s + c.cost, 0);
  const profit = stats.totalInvoiced - totalCost;
  const margin = stats.totalInvoiced > 0 ? (profit / stats.totalInvoiced) * 100 : 0;

  return (
    <div className="px-6 lg:px-8 xl:px-10 py-6 space-y-6" data-testid="project-detail-page">
      <PageBreadcrumbs
        page={project.name}
        showDashboard={false}
        items={[
          {
            label: "Projects",
            onClick: () => navigate("/projects"),
            testId: "link-back-projects",
            withBackArrow: true,
          },
        ]}
      />

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <Card className="overflow-hidden" style={{ borderColor: "var(--lux-border)", background: "var(--lux-surface)" }}>
            <div className="h-1" style={{ background: projectColor }} data-testid="project-color-bar" />
            <div className="p-6 space-y-3">
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-bold" style={{ color: "var(--lux-text)" }} data-testid="text-project-name">
                  {project.name}
                </h1>
                <PageHelpLink />
              </div>
              <p className="text-sm" style={{ color: "var(--lux-text-muted)" }} data-testid="text-project-client">
                For {project.clientName}
              </p>
              {project.description && (
                <p className="text-sm" style={{ color: "var(--lux-text-secondary)" }} data-testid="text-project-description">
                  {project.description}
                </p>
              )}
              <div className="space-y-1 pt-2">
                {project.startDate && (
                  <div className="flex items-center gap-2 text-sm" style={{ color: "var(--lux-text-secondary)" }}>
                    <Calendar size={14} /> Start: <DateDisplay value={project.startDate} />
                  </div>
                )}
                {project.endDate && (
                  <div className="flex items-center gap-2 text-sm" style={{ color: "var(--lux-text-secondary)" }}>
                    <Calendar size={14} /> End: <DateDisplay value={project.endDate} />
                  </div>
                )}
              </div>
              <div className="pt-2">
                <StatusBadge status={project.status} />
              </div>
            </div>
          </Card>

          {isAdmin && (
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={() => setEditOpen(true)} data-testid="button-edit-project" className="gap-2">
                <Pencil size={14} /> Edit
              </Button>
              <Button variant="outline" onClick={() => navigate(`/admin/rate-matrix/${project.id}`)} data-testid="button-rate-matrix" className="gap-2">
                <Grid3X3 size={14} /> Rate Matrix
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" data-testid="button-more-actions" aria-label="More actions">
                    <MoreVertical size={14} />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem onClick={() => duplicateMutation.mutate()} data-testid="menu-duplicate-project">
                    <Copy size={14} className="mr-2" /> Duplicate Project
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => archiveMutation.mutate()} data-testid="menu-archive-project">
                    <Archive size={14} className="mr-2" /> Archive Project
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>

        <div className="lg:col-span-3">
          <Card style={{ borderColor: "var(--lux-border)", background: "var(--lux-surface)" }}>
            <div className="p-6">
              <div className="flex items-center gap-4 mb-4 border-b pb-3" style={{ borderColor: "var(--lux-border)" }}>
                <button
                  onClick={() => setMetricsTab("hours")}
                  className={`text-sm font-medium pb-1 ${metricsTab === "hours" ? "border-b-2" : ""}`}
                  style={{
                    color: metricsTab === "hours" ? "var(--lux-accent)" : "var(--lux-text-muted)",
                    borderColor: metricsTab === "hours" ? "var(--lux-accent)" : "transparent",
                  }}
                  data-testid="tab-hours-logged"
                >
                  Hours Logged
                </button>
                {isAdmin && (
                  <button
                    onClick={() => setMetricsTab("profitability")}
                    className={`text-sm font-medium pb-1 ${metricsTab === "profitability" ? "border-b-2" : ""}`}
                    style={{
                      color: metricsTab === "profitability" ? "var(--lux-accent)" : "var(--lux-text-muted)",
                      borderColor: metricsTab === "profitability" ? "var(--lux-accent)" : "transparent",
                    }}
                    data-testid="tab-profitability"
                  >
                    Profitability
                  </button>
                )}
              </div>

              {metricsTab === "hours" && (
                <div className="space-y-4" data-testid="panel-hours-logged">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium" style={{ color: "var(--lux-text-muted)" }}>Hours Logged</span>
                    <span className="text-xl font-bold tabular-nums" style={{ color: "var(--lux-text)" }} data-testid="text-total-hours">
                      {formatHoursMinutes(Math.round(stats.totalHoursLogged * 60))}
                    </span>
                  </div>

                  {stats.budgetHours != null && (
                    <div className="space-y-1">
                      <div className="h-3 rounded-full overflow-hidden" style={{ background: "var(--lux-border)" }}>
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${Math.min(100, stats.budgetUsedPercent || 0)}%`,
                            background: (stats.budgetUsedPercent || 0) > 100 ? "#ef4444" : "var(--lux-accent)",
                          }}
                          data-testid="progress-budget"
                        />
                      </div>
                      <div className="flex justify-between text-xs" style={{ color: "var(--lux-text-muted)" }}>
                        <span>0h</span>
                        <span>{stats.budgetHours}h budget</span>
                      </div>
                    </div>
                  )}

                  {hoursByMember.length > 0 && (
                    <div className="h-40 pt-2" data-testid="chart-hours-by-member">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={hoursByMember} layout="vertical" margin={{ left: 0, right: 10 }}>
                          <XAxis type="number" tick={{ fontSize: 11 }} />
                          <YAxis type="category" dataKey="userName" width={100} tick={{ fontSize: 11 }} />
                          <Tooltip formatter={(v: number) => formatHoursMinutes(Math.round(v * 60))} />
                          <Bar dataKey="billableHours" stackId="hours" name="Billable" radius={[0, 0, 0, 0]}>
                            {hoursByMember.map((_h, i) => (
                              <Cell key={i} fill={MEMBER_COLORS[i % MEMBER_COLORS.length]} />
                            ))}
                          </Bar>
                          <Bar dataKey="nonBillableHours" stackId="hours" name="Non-Billable" radius={[0, 4, 4, 0]}>
                            {hoursByMember.map((_h, i) => (
                              <Cell key={i} fill={MEMBER_COLORS[i % MEMBER_COLORS.length]} opacity={0.4} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}

                  <div className="space-y-2 pt-2">
                    {hoursByMember.map((h, i) => (
                      <div key={h.userId} className="flex items-center gap-2 text-sm" data-testid={`member-hours-${i}`}>
                        <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: MEMBER_COLORS[i % MEMBER_COLORS.length] }} />
                        <span style={{ color: "var(--lux-text)" }} className="flex-1">{h.userName}</span>
                        <span className="font-medium tabular-nums" style={{ color: "var(--lux-text)" }}>
                          {formatHoursMinutes(Math.round(h.totalHours * 60))}
                        </span>
                      </div>
                    ))}
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pt-3">
                    <StatCard
                      icon={AlertTriangle}
                      label="Over Budget"
                      value={formatHoursMinutes(Math.round(stats.overBudgetHours * 60))}
                      color={stats.overBudgetHours > 0 ? "#ef4444" : undefined}
                      testId="stat-over-budget"
                    />
                    <StatCard
                      icon={Clock}
                      label="Unbilled Time"
                      value={formatHoursMinutes(Math.round(stats.unbilledHours * 60))}
                      color={stats.unbilledHours > 0 ? "#f59e0b" : undefined}
                      testId="stat-unbilled-time"
                    />
                    {isAdmin && (
                      <StatCard
                        icon={DollarSign}
                        label="Unbilled Amount"
                        value={formatMoney(stats.unbilledAmount, baseCurrency)}
                        color={stats.unbilledAmount > 0 ? "#f59e0b" : undefined}
                        testId="stat-unbilled-amount"
                      />
                    )}
                    {stats.daysUntilDue != null && (
                      <StatCard
                        icon={Calendar}
                        label="Days Until Due"
                        value={String(stats.daysUntilDue)}
                        color={stats.daysUntilDue < 14 ? "#ef4444" : stats.daysUntilDue < 30 ? "#f59e0b" : "#22c55e"}
                        testId="stat-days-until-due"
                      />
                    )}
                    {stats.budgetUsedPercent != null && (
                      <StatCard
                        icon={BarChart3}
                        label="Budget Used"
                        value={formatPercent(stats.budgetUsedPercent)}
                        color={stats.budgetUsedPercent > 100 ? "#ef4444" : stats.budgetUsedPercent > 80 ? "#f59e0b" : undefined}
                        testId="stat-budget-used"
                      />
                    )}
                    {stats.budgetRemaining != null && (
                      <StatCard
                        icon={TrendingUp}
                        label="Budget Remaining"
                        value={formatHoursMinutes(Math.round(stats.budgetRemaining * 60))}
                        testId="stat-budget-remaining"
                      />
                    )}
                  </div>
                </div>
              )}

              {metricsTab === "profitability" && isAdmin && (
                <div className="space-y-4" data-testid="panel-profitability">
                  <div className="grid grid-cols-3 gap-3">
                    <StatCard
                      icon={DollarSign}
                      label="Revenue"
                      value={formatMoney(stats.totalInvoiced, baseCurrency)}
                      color="#22c55e"
                      testId="stat-revenue"
                    />
                    <StatCard
                      icon={Users}
                      label="Cost"
                      value={formatMoney(totalCost, baseCurrency)}
                      color="#ef4444"
                      testId="stat-cost"
                    />
                    <StatCard
                      icon={TrendingUp}
                      label="Profit"
                      value={formatMoney(profit, baseCurrency)}
                      subValue={`${formatPercent(margin)} margin`}
                      color={profit >= 0 ? "#22c55e" : "#ef4444"}
                      testId="stat-profit"
                    />
                  </div>
                  <div className="h-48">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={[
                        { name: "Revenue", value: stats.totalInvoiced },
                        { name: "Cost", value: totalCost },
                        { name: "Profit", value: profit },
                      ]}>
                        <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                        <YAxis tick={{ fontSize: 12 }} />
                        <Tooltip formatter={(v: number) => formatMoney(v, baseCurrency)} />
                        <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                          <Cell fill="#22c55e" />
                          <Cell fill="#ef4444" />
                          <Cell fill={profit >= 0 ? "#3b82f6" : "#ef4444"} />
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>

      <Card style={{ borderColor: "var(--lux-border)", background: "var(--lux-surface)" }}>
        <Tabs value={bottomTab} onValueChange={setBottomTab}>
          <div className="border-b px-6 pt-4" style={{ borderColor: "var(--lux-border)" }}>
            <TabsList className="bg-transparent gap-1 p-0 h-auto">
              <TabsTrigger value="time" className="data-[state=active]:bg-transparent data-[state=active]:shadow-none rounded-none border-b-2 border-transparent data-[state=active]:border-[var(--lux-accent)] px-4 pb-3" data-testid="tab-time-tracking">
                <Clock size={14} className="mr-1.5" /> Time Tracking
              </TabsTrigger>
              {isAdmin && (
                <TabsTrigger value="invoices" className="data-[state=active]:bg-transparent data-[state=active]:shadow-none rounded-none border-b-2 border-transparent data-[state=active]:border-[var(--lux-accent)] px-4 pb-3" data-testid="tab-invoices">
                  <FileText size={14} className="mr-1.5" /> Invoices
                </TabsTrigger>
              )}
              {isAdmin && (
                <TabsTrigger value="estimates" className="data-[state=active]:bg-transparent data-[state=active]:shadow-none rounded-none border-b-2 border-transparent data-[state=active]:border-[var(--lux-accent)] px-4 pb-3" data-testid="tab-estimates">
                  <Briefcase size={14} className="mr-1.5" /> Estimates
                </TabsTrigger>
              )}
              <TabsTrigger value="services" className="data-[state=active]:bg-transparent data-[state=active]:shadow-none rounded-none border-b-2 border-transparent data-[state=active]:border-[var(--lux-accent)] px-4 pb-3" data-testid="tab-services">
                <BarChart3 size={14} className="mr-1.5" /> Services
              </TabsTrigger>
              <TabsTrigger value="members" className="data-[state=active]:bg-transparent data-[state=active]:shadow-none rounded-none border-b-2 border-transparent data-[state=active]:border-[var(--lux-accent)] px-4 pb-3" data-testid="tab-members">
                <Users size={14} className="mr-1.5" /> Members
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="time" className="p-6 mt-0">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold" style={{ color: "var(--lux-text)" }}>All Time Entries</h3>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  className="gap-1.5 text-white"
                  style={{ background: "var(--gradient-brand)" }}
                  onClick={() => setTimeDialogOpen(true)}
                  data-testid="button-add-time-entry"
                >
                  <Plus size={14} />
                  Log Time
                </Button>
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--lux-text-muted)" }} />
                  <Input
                    placeholder="Search entries..."
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                    className="pl-9 h-8 w-48"
                    data-testid="input-search-entries"
                  />
                </div>
              </div>
            </div>

            {filteredEntries.length === 0 ? (
              <EmptyState icon={Clock} title="No time entries" description="No time entries have been logged for this project yet." />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Team Member / Date</TableHead>
                    <TableHead>Service / Note</TableHead>
                    <TableHead className="text-right">Time</TableHead>
                    <TableHead className="text-right">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredEntries.map(entry => (
                    <TableRow key={entry.id} data-testid={`row-entry-${entry.id}`}>
                      <TableCell>
                        <div className="text-sm font-medium" style={{ color: "var(--lux-text)" }}>
                          {entry.startTime && <span>{formatTime12h(entry.startTime)} </span>}
                          {entry.userName}
                        </div>
                        <div className="text-xs" style={{ color: "var(--lux-text-muted)" }}>
                          {entry.endTime && <span>{formatTime12h(entry.endTime)} · </span>}
                          {formatDate(entry.date)}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm" style={{ color: "var(--lux-text)" }}>{entry.serviceName || "—"}</div>
                        <div className="text-xs truncate max-w-[200px]" style={{ color: "var(--lux-text-muted)" }}>{entry.notes || ""}</div>
                      </TableCell>
                      <TableCell className="text-right">
                        <span className="text-sm font-medium tabular-nums" style={{ color: "var(--lux-text)" }}>
                          {formatHoursMinutes(entry.minutes)}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <StatusBadge status={entry.invoiced ? "BILLED" : "UNBILLED"} size="xs" />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </TabsContent>

          <TabsContent value="invoices" className="p-6 mt-0">
            {projectInvoices.length === 0 ? (
              <EmptyState icon={FileText} title="No invoices" description="No invoices have been generated for this project yet." />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Number</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Outstanding</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {projectInvoices.map(inv => (
                    <TableRow
                      key={inv.id}
                      className="cursor-pointer"
                      onClick={() => navigate("/invoices")}
                      data-testid={`row-invoice-${inv.id}`}
                    >
                      <TableCell className="font-medium" style={{ color: "var(--lux-text)" }}>{inv.number}</TableCell>
                      <TableCell><DateDisplay value={inv.issuedDate} /></TableCell>
                      <TableCell className="text-right"><MoneyDisplay currency={baseCurrency} value={inv.total} /></TableCell>
                      <TableCell><StatusBadge status={inv.status} size="xs" /></TableCell>
                      <TableCell className="text-right">
                        <MoneyDisplay currency={baseCurrency} value={Number(inv.total) - Number(inv.paidAmount)} color="auto" />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </TabsContent>

          <TabsContent value="estimates" className="p-6 mt-0">
            {projectEstimates.length === 0 ? (
              <EmptyState icon={Briefcase} title="No estimates" description="No estimates found for this project's client." />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Number</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {projectEstimates.map(est => (
                    <TableRow
                      key={est.id}
                      className="cursor-pointer"
                      onClick={() => navigate("/estimates")}
                      data-testid={`row-estimate-${est.id}`}
                    >
                      <TableCell className="font-medium" style={{ color: "var(--lux-text)" }}>{est.number}</TableCell>
                      <TableCell><DateDisplay value={est.issuedDate} /></TableCell>
                      <TableCell className="text-right"><MoneyDisplay currency={baseCurrency} value={est.total} /></TableCell>
                      <TableCell><StatusBadge status={est.status} size="xs" /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </TabsContent>

          <TabsContent value="services" className="p-6 mt-0">
            <div className="space-y-5">
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-semibold" style={{ color: "var(--lux-text)" }}>Assigned Services</h4>
                  {isAdmin && !showAssignService && (
                    <Button variant="outline" size="sm" onClick={() => setShowAssignService(true)} data-testid="button-assign-service">
                      <Plus className="w-4 h-4 mr-1" /> Assign Service
                    </Button>
                  )}
                </div>

                {showAssignService && (
                  <div className="flex items-center gap-2 mb-3 p-3 rounded-lg" style={{ border: "1px dashed var(--lux-border-strong)" }} data-testid="assign-service-form">
                    <Select value={assignServiceId} onValueChange={setAssignServiceId}>
                      <SelectTrigger className="flex-1" data-testid="select-assign-service">
                        <SelectValue placeholder="Select a service to assign" />
                      </SelectTrigger>
                      <SelectContent>
                        {services?.filter((s: any) => s.isActive && !assignedServices.some((as: any) => as.serviceId === s.id)).map((s: any) => (
                          <SelectItem key={s.id} value={s.id}>{s.name}{s.defaultRate ? ` — ${formatRate(s.defaultRate)}` : ""}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button size="sm" className="text-white" style={{ background: "var(--gradient-brand)" }} onClick={() => assignServiceMutation.mutate()} disabled={!assignServiceId || assignServiceMutation.isPending} data-testid="button-confirm-assign-service">
                      {assignServiceMutation.isPending ? "..." : "Add"}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => { setShowAssignService(false); setAssignServiceId(""); }} data-testid="button-cancel-assign-service">
                      Cancel
                    </Button>
                  </div>
                )}

                {assignedServices.length > 0 ? (
                  <div className="space-y-2">
                    {assignedServices.map((as: any) => (
                      <div key={as.id} className="flex items-center justify-between rounded-lg px-4 py-3" style={{ background: "var(--lux-surface-alt)" }} data-testid={`assigned-service-${as.serviceId}`}>
                        <div className="flex items-center gap-3">
                          <BarChart3 className="w-4 h-4 flex-shrink-0" style={{ color: "var(--lux-accent, #cf3339)" }} />
                          <div>
                            <p className="text-sm font-semibold" style={{ color: "var(--lux-text)" }}>{as.serviceName}</p>
                            {as.defaultRate && (
                              <p className="text-xs" style={{ color: "var(--lux-text-muted)" }}>Default rate: {formatRate(as.defaultRate)}</p>
                            )}
                          </div>
                        </div>
                        {isAdmin && (
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500" onClick={() => removeServiceMutation.mutate(as.id)} data-testid={`button-remove-service-${as.serviceId}`} aria-label="Remove service">
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-4">
                    <p className="text-sm" style={{ color: "var(--lux-text-muted)" }}>
                      No services assigned yet. Assign services to control which ones appear when logging time on this project.
                    </p>
                  </div>
                )}
              </div>

              {projectServices.length > 0 && (
                <div className="pt-4" style={{ borderTop: "1px solid var(--lux-border)" }}>
                  <h4 className="text-sm font-semibold mb-3" style={{ color: "var(--lux-text)" }}>Hours by Service</h4>
                  <div className="space-y-3">
                    {projectServices.map((svc: any, i: number) => {
                      const pct = totalServiceHours > 0 ? (svc.hoursLogged / totalServiceHours) * 100 : 0;
                      return (
                        <div key={svc.id} className="space-y-1" data-testid={`service-hours-row-${i}`}>
                          <div className="flex items-center justify-between text-sm">
                            <span style={{ color: "var(--lux-text)" }}>{svc.name}</span>
                            <span className="font-medium tabular-nums" style={{ color: "var(--lux-text)" }}>
                              {formatHoursMinutes(Math.round(svc.hoursLogged * 60))} ({formatPercent(pct)})
                            </span>
                          </div>
                          <div className="h-2 rounded-full overflow-hidden" style={{ background: "var(--lux-border)" }}>
                            <div
                              className="h-full rounded-full"
                              style={{ width: `${pct}%`, background: MEMBER_COLORS[i % MEMBER_COLORS.length] }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="members" className="p-6 mt-0">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold" style={{ color: "var(--lux-text)" }}>Project Members</h3>
              {isAdmin && !showAddMember && (
                <Button variant="outline" size="sm" onClick={() => setShowAddMember(true)} data-testid="button-add-member">
                  <UserPlus className="w-4 h-4 mr-1" /> Add Member
                </Button>
              )}
            </div>

            {showAddMember && (
              <div className="flex flex-col gap-3 mb-4 p-4 rounded-lg" style={{ border: "1px dashed var(--lux-border-strong)" }} data-testid="add-member-form">
                <div className="flex items-center gap-2">
                  <Select value={addMemberUserId} onValueChange={setAddMemberUserId}>
                    <SelectTrigger className="flex-1" data-testid="select-add-member">
                      <SelectValue placeholder="Select a team member" />
                    </SelectTrigger>
                    <SelectContent>
                      {teamList?.filter((u: any) => u.isActive && !membersData?.some((m: any) => m.userId === u.id)).map((u: any) => (
                        <SelectItem key={u.id} value={u.id} data-testid={`option-member-${u.id}`}>{u.name} ({u.email})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    placeholder="Bill rate ($/hr)"
                    value={addMemberBillRate}
                    onChange={(e) => setAddMemberBillRate(e.target.value)}
                    className="flex-1"
                    data-testid="input-member-bill-rate"
                  />
                  <Input
                    type="number"
                    placeholder="Cost rate ($/hr)"
                    value={addMemberCostRate}
                    onChange={(e) => setAddMemberCostRate(e.target.value)}
                    className="flex-1"
                    data-testid="input-member-cost-rate"
                  />
                  <Button size="sm" className="text-white" style={{ background: "var(--gradient-brand)" }} onClick={() => addMemberMutation.mutate()} disabled={!addMemberUserId || addMemberMutation.isPending} data-testid="button-confirm-add-member">
                    {addMemberMutation.isPending ? "..." : "Add"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => { setShowAddMember(false); setAddMemberUserId(""); setAddMemberBillRate(""); setAddMemberCostRate(""); }} data-testid="button-cancel-add-member">
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {membersLoading ? (
              <div className="text-center py-8">
                <p className="text-sm" style={{ color: "var(--lux-text-muted)" }}>Loading members...</p>
              </div>
            ) : membersError ? (
              <div className="text-center py-8">
                <AlertTriangle className="w-8 h-8 mx-auto mb-2" style={{ color: "var(--lux-text-muted)" }} />
                <p className="text-sm" style={{ color: "var(--lux-text-muted)" }}>Failed to load members. Please try again.</p>
              </div>
            ) : membersData && membersData.length > 0 ? (
              <div className="space-y-2">
                {membersData.map((m: any) => (
                  <div key={m.id} className="flex items-center justify-between rounded-lg px-4 py-3" style={{ background: "var(--lux-surface-alt)" }} data-testid={`member-row-${m.userId}`}>
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ background: "var(--gradient-brand)" }}>
                        {(m.name || "?").charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <p className="text-sm font-semibold" style={{ color: "var(--lux-text)" }}>{m.name}</p>
                        <p className="text-xs" style={{ color: "var(--lux-text-muted)" }}>{m.email}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <p className="text-xs" style={{ color: "var(--lux-text-muted)" }}>Bill Rate</p>
                        <p className="text-sm font-medium tabular-nums" style={{ color: "var(--lux-text)" }}>${parseFloat(m.billRate || 0).toFixed(2)}/hr</p>
                      </div>
                      {isAdmin && (
                        <div className="text-right">
                          <p className="text-xs" style={{ color: "var(--lux-text-muted)" }}>Cost Rate</p>
                          <div className="flex items-center justify-end">
                            <p className="text-sm font-medium tabular-nums" style={{ color: "var(--lux-text)" }} data-testid={`text-member-cost-rate-${m.userId}`}>${parseFloat(m.costRate || 0).toFixed(2)}/hr</p>
                            <CostRateInlineEditor
                              projectId={id}
                              userId={m.userId}
                              teamMemberName={m.name}
                              projectName={project.name}
                              baseCurrency={baseCurrency}
                              triggerVariant="default"
                              invalidateKeys={[
                                ["/api/projects", id, "members"],
                                ["/api/projects", id],
                                ["/api/payouts/summary"],
                              ]}
                            />
                          </div>
                        </div>
                      )}
                      {isAdmin && (
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500" onClick={() => removeMemberMutation.mutate(m.id)} data-testid={`button-remove-member-${m.userId}`} aria-label="Remove member">
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                icon={Users}
                title="No members assigned"
                description="Add team members to this project to track their time and billing rates."
              />
            )}
          </TabsContent>
        </Tabs>
      </Card>

      {isAdmin && editOpen && (
        <EditProjectDialog
          project={project}
          onClose={() => setEditOpen(false)}
          projectId={id}
        />
      )}

      <TimeEntryDialog
        open={timeDialogOpen}
        onOpenChange={(open) => {
          setTimeDialogOpen(open);
          if (!open) {
            queryClient.invalidateQueries({ queryKey: ["/api/projects", id] });
          }
        }}
        myProjects={dialogProjects}
        services={services}
        defaultProjectId={project.id}
        defaultDate={new Date().toISOString().split("T")[0]}
        editEntry={null}
      />
    </div>
  );
}

function EditProjectDialog({
  project,
  onClose,
  projectId,
}: {
  project: ProjectDetailData["project"];
  onClose: () => void;
  projectId: string;
}) {
  const { toast } = useToast();
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description || "");
  const [status, setStatus] = useState(project.status);
  const [budgetHours, setBudgetHours] = useState(project.budgetHours || "");
  const [startDate, setStartDate] = useState(project.startDate || "");
  const [endDate, setEndDate] = useState(project.endDate || "");

  const updateMutation = useMutation({
    mutationFn: (data: Record<string, any>) => apiRequest("PATCH", `/api/projects/${projectId}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      toast({ title: "Project updated" });
      onClose();
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const handleSave = () => {
    updateMutation.mutate({
      name,
      description: description || null,
      status,
      budgetHours: budgetHours ? Number(budgetHours) : null,
      startDate: startDate || null,
      endDate: endDate || null,
    });
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg" data-testid="dialog-edit-project">
        <DialogHeader>
          <DialogTitle>Edit Project</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <FormSection title="Details">
            <div className="space-y-3">
              <div>
                <Label>Name</Label>
                <Input value={name} onChange={e => setName(e.target.value)} data-testid="input-edit-name" />
              </div>
              <div>
                <Label>Description</Label>
                <Textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} data-testid="input-edit-description" />
              </div>
              <div>
                <Label>Status</Label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger data-testid="select-edit-status">
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
            </div>
          </FormSection>

          <FormSection title="Budget & Timeline">
            <div className="space-y-3">
              <div>
                <Label>Budget Hours</Label>
                <Input type="number" value={budgetHours} onChange={e => setBudgetHours(e.target.value)} placeholder="No budget" data-testid="input-edit-budget-hours" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Start Date</Label>
                  <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} data-testid="input-edit-start-date" />
                </div>
                <div>
                  <Label>End Date</Label>
                  <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} data-testid="input-edit-end-date" />
                </div>
              </div>
            </div>
          </FormSection>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose} data-testid="button-cancel-edit">Cancel</Button>
            <Button onClick={handleSave} disabled={updateMutation.isPending} data-testid="button-save-project">
              {updateMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
