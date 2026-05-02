import { formatPercent } from "@/components/shared/format";
import { formatHoursMinutes } from "./utils";

interface WeekSummaryProps {
  weekBillable: number;
  weekNonBillable: number;
  weekTotal: number;
  weekUtilization: number;
}

export default function WeekSummary({ weekBillable, weekNonBillable, weekTotal, weekUtilization }: WeekSummaryProps) {
  return (
    <div
      className="sticky bottom-0 rounded-lg px-4 py-3 text-center text-sm font-medium"
      style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)", color: "var(--lux-text-secondary)" }}
      data-testid="text-week-summary-footer"
    >
      This week: {formatHoursMinutes(weekBillable)} billable + {formatHoursMinutes(weekNonBillable)} internal = {formatHoursMinutes(weekTotal)} ({formatPercent(weekUtilization)} util)
    </div>
  );
}
