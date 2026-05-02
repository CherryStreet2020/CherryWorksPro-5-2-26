import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Filter } from "lucide-react";

interface TimeFiltersProps {
  isAdmin: boolean;
  teamMemberFilter: string;
  setTeamMemberFilter: (v: string) => void;
  projectFilter: string;
  setProjectFilter: (v: string) => void;
  dateRangeFilter: string;
  setDateRangeFilter: (v: string) => void;
  billableFilter: string;
  setBillableFilter: (v: string) => void;
  customDateStart: string;
  setCustomDateStart: (v: string) => void;
  customDateEnd: string;
  setCustomDateEnd: (v: string) => void;
  uniqueTeamMembers: Array<{ id: string; name: string }>;
  uniqueProjects: Array<{ id: string; name: string }>;
}

export default function TimeFilters(props: TimeFiltersProps) {
  const {
    isAdmin, teamMemberFilter, setTeamMemberFilter,
    projectFilter, setProjectFilter,
    dateRangeFilter, setDateRangeFilter,
    billableFilter, setBillableFilter,
    customDateStart, setCustomDateStart,
    customDateEnd, setCustomDateEnd,
    uniqueTeamMembers, uniqueProjects,
  } = props;

  return (
    <Card className="border-0" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }}>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-2 mb-1">
          <Filter className="w-4 h-4" style={{ color: "var(--lux-text-muted)" }} />
          <span className="text-sm font-semibold" style={{ color: "var(--lux-text)" }}>Filters</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {isAdmin && (
            <div className="space-y-1">
              <Label className="text-xs" style={{ color: "var(--lux-text-muted)" }}>Team Member</Label>
              <Select value={teamMemberFilter} onValueChange={setTeamMemberFilter}>
                <SelectTrigger data-testid="select-filter-team-member">
                  <SelectValue placeholder="All team members" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Team Members</SelectItem>
                  {uniqueTeamMembers.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1">
            <Label className="text-xs" style={{ color: "var(--lux-text-muted)" }}>Project</Label>
            <Select value={projectFilter} onValueChange={setProjectFilter}>
              <SelectTrigger data-testid="select-filter-project">
                <SelectValue placeholder="All projects" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Projects</SelectItem>
                {uniqueProjects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs" style={{ color: "var(--lux-text-muted)" }}>Date Range</Label>
            <Select value={dateRangeFilter} onValueChange={setDateRangeFilter}>
              <SelectTrigger data-testid="select-filter-date-range">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Time</SelectItem>
                <SelectItem value="this-week">This Week</SelectItem>
                <SelectItem value="last-week">Last Week</SelectItem>
                <SelectItem value="this-month">This Month</SelectItem>
                <SelectItem value="custom">Custom</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs" style={{ color: "var(--lux-text-muted)" }}>Billable</Label>
            <Select value={billableFilter} onValueChange={setBillableFilter}>
              <SelectTrigger data-testid="select-filter-billable">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="billable">Billable</SelectItem>
                <SelectItem value="non-billable">Non-Billable</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        {dateRangeFilter === "custom" && (
          <div className="flex items-center gap-3 flex-wrap">
            <div className="space-y-1">
              <Label className="text-xs" style={{ color: "var(--lux-text-muted)" }}>Start Date</Label>
              <Input type="date" value={customDateStart} onChange={(e) => setCustomDateStart(e.target.value)} data-testid="input-filter-date-start" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs" style={{ color: "var(--lux-text-muted)" }}>End Date</Label>
              <Input type="date" value={customDateEnd} onChange={(e) => setCustomDateEnd(e.target.value)} data-testid="input-filter-date-end" />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
