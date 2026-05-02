import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/shared/status-badge";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { formatHoursMinutes } from "./utils";
import { getWeekEndDate } from "@shared/schema";
import { Undo2 } from "lucide-react";
import type { TimesheetWeek } from "@shared/schema";

interface MySubmissionRow extends TimesheetWeek {
  totalMinutes: number;
  billableMinutes: number;
}

function formatRange(weekStartDate: string): string {
  const start = new Date(weekStartDate + "T12:00:00");
  const end = new Date(getWeekEndDate(weekStartDate) + "T12:00:00");
  return `${start.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${end.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
}

function formatSubmittedAt(d: Date | string | null | undefined): string {
  if (!d) return "";
  const dt = typeof d === "string" ? new Date(d) : d;
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function MySubmissions({ onJumpToWeek }: { onJumpToWeek?: (weekStartDate: string) => void }) {
  const { toast } = useToast();

  const { data, isLoading } = useQuery<MySubmissionRow[]>({
    queryKey: ["/api/timesheets/my-recent"],
  });

  const recallMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("POST", `/api/timesheets/${id}/recall`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/timesheets/my-recent"] });
      queryClient.invalidateQueries({ queryKey: ["/api/timesheets/my-week"] });
      queryClient.invalidateQueries({ queryKey: ["/api/timesheets/pending"] });
      queryClient.invalidateQueries({ queryKey: ["/api/timesheets/all"] });
      toast({ title: "Timesheet recalled", description: "Back to draft. You can edit and resubmit." });
    },
    onError: (err: Error) => {
      toast({ title: "Could not recall", description: err.message, variant: "destructive" });
    },
  });

  const rows = data || [];

  return (
    <Card
      className="border-0 overflow-hidden"
      style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }}
      data-testid="card-my-submissions"
    >
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold" style={{ color: "var(--lux-text)" }}>
          My Submissions
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4 pt-0">
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : rows.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--lux-text-muted)" }} data-testid="text-no-submissions">
            No submissions yet. Track time during the week and submit it for approval here.
          </p>
        ) : (
          <ul className="divide-y" style={{ borderColor: "var(--lux-border)" }}>
            {rows.map((row) => (
              <li
                key={row.id}
                className="flex items-center justify-between gap-3 py-2"
                data-testid={`row-my-submission-${row.id}`}
              >
                <div className="min-w-0 flex-1">
                  <button
                    type="button"
                    className="text-sm font-medium text-left hover:underline truncate block"
                    style={{ color: "var(--lux-text)" }}
                    onClick={() => onJumpToWeek?.(row.weekStartDate)}
                    data-testid={`button-jump-week-${row.id}`}
                  >
                    Week of {formatRange(row.weekStartDate)}
                  </button>
                  <p className="text-xs" style={{ color: "var(--lux-text-muted)" }}>
                    {formatHoursMinutes(row.totalMinutes)}
                    {row.status === "SUBMITTED" && row.submittedAt && (
                      <> · Submitted {formatSubmittedAt(row.submittedAt)}</>
                    )}
                    {row.status === "APPROVED" && row.approvedAt && (
                      <> · Approved {formatSubmittedAt(row.approvedAt)}</>
                    )}
                    {row.status === "REJECTED" && row.rejectionReason && (
                      <> · Reason: {row.rejectionReason}</>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <StatusBadge status={row.status} size="xs" />
                  {row.status === "SUBMITTED" && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => recallMutation.mutate(row.id)}
                      disabled={recallMutation.isPending}
                      data-testid={`button-recall-${row.id}`}
                    >
                      <Undo2 className="w-3.5 h-3.5 mr-1" />
                      Recall
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
