/**
 * Task #465 — render the time-entry detail block for one aggregated
 * invoice line. Used by both the public client portal page and the
 * in-app invoice detail panel so the two views stay byte-equivalent.
 *
 * Pure presentation: never recomputes money totals. The `items`
 * stream is built server-side by `getInvoiceTimeEntryDetails` and the
 * `kind` discriminator decides which row variant to render.
 */

export type DetailItem =
  | { kind: "day"; date: string; weekday: string; totalHours: number }
  | {
      kind: "entry";
      id: string;
      startTime: string | null;
      endTime: string | null;
      project: string;
      ticket: string | null;
      description: string;
      hours: number;
      billable: boolean;
    }
  | {
      kind: "week";
      weekStart: string;
      billableHours: number;
      internalHours: number;
      totalHours: number;
    };

function formatHM(hours: number): string {
  const total = Math.round(Math.abs(hours) * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${hours < 0 ? "-" : ""}${h}:${m.toString().padStart(2, "0")}`;
}

export function InvoiceDetailRows({
  items,
  colSpan,
  testIdPrefix,
}: {
  items: DetailItem[];
  /** Number of columns in the parent table (so the detail rows span fully). */
  colSpan: number;
  testIdPrefix: string;
}) {
  if (!items || items.length === 0) return null;
  return (
    <>
      {items.map((it, i) => {
        if (it.kind === "day") {
          return (
            <tr
              key={`${testIdPrefix}-day-${i}`}
              data-testid={`${testIdPrefix}-day-${it.date}`}
              style={{ background: "var(--lux-bg, #f8fafc)" }}
            >
              <td
                colSpan={colSpan}
                className="px-6 py-1.5 text-[11px] font-bold uppercase tracking-wider"
                style={{ color: "var(--lux-text)" }}
              >
                <div className="flex items-center justify-between">
                  <span>{it.weekday}</span>
                  <span
                    className="font-mono font-normal"
                    style={{ color: "var(--lux-text-muted)" }}
                  >
                    {formatHM(it.totalHours)} h
                  </span>
                </div>
              </td>
            </tr>
          );
        }
        if (it.kind === "week") {
          return (
            <tr
              key={`${testIdPrefix}-week-${i}`}
              data-testid={`${testIdPrefix}-week-${it.weekStart}`}
            >
              <td
                colSpan={colSpan}
                className="px-6 py-1.5 text-right text-[11px] italic"
                style={{
                  color: "var(--lux-text-muted)",
                  borderTop: "1px dashed var(--lux-border, #e2e8f0)",
                }}
              >
                This week: {formatHM(it.billableHours)} billable
                {" + "}
                {formatHM(it.internalHours)} internal ={" "}
                <span className="font-semibold not-italic">
                  {formatHM(it.totalHours)}
                </span>
              </td>
            </tr>
          );
        }
        // entry row
        const timeText =
          it.startTime && it.endTime ? `${it.startTime}–${it.endTime}` : "—";
        return (
          <tr
            key={`${testIdPrefix}-entry-${it.id}`}
            data-testid={`${testIdPrefix}-entry-${it.id}`}
          >
            <td
              colSpan={colSpan}
              className="px-6 py-1 text-[11px]"
              style={{ color: "var(--lux-text-secondary)" }}
            >
              <div className="flex items-center gap-3">
                <span
                  className="font-mono shrink-0"
                  style={{ color: "var(--lux-text-muted)", width: 92 }}
                >
                  {timeText}
                </span>
                <span
                  className="shrink-0 truncate"
                  style={{ color: "var(--lux-text)", width: 110 }}
                  title={it.project}
                  data-testid={`${testIdPrefix}-project-${it.id}`}
                >
                  {it.project}
                </span>
                <span
                  className="font-semibold shrink-0"
                  style={{ color: "var(--lux-text)", width: 70 }}
                  data-testid={`${testIdPrefix}-ticket-${it.id}`}
                >
                  {it.ticket || ""}
                </span>
                <span
                  className="flex-1 truncate"
                  style={{ color: "var(--lux-text-muted)" }}
                  title={it.description || ""}
                  data-testid={`${testIdPrefix}-desc-${it.id}`}
                >
                  {it.description || ""}
                </span>
                <span
                  className="font-mono tabular-nums shrink-0"
                  style={{ color: "var(--lux-text)", width: 48, textAlign: "right" }}
                >
                  {formatHM(it.hours)}
                </span>
                <span
                  className="text-[9px] font-bold uppercase tracking-wider shrink-0"
                  style={{
                    color: it.billable ? "var(--lux-accent)" : "var(--lux-text-muted)",
                    width: 60,
                    textAlign: "right",
                  }}
                  data-testid={`${testIdPrefix}-tag-${it.id}`}
                >
                  {/* Task #465: the spec calls for a "billable tag";
                      we use "Billable" / "Internal" to match the
                      existing in-app worklog vocabulary. */}
                  {it.billable ? "Billable" : "Internal"}
                </span>
              </div>
            </td>
          </tr>
        );
      })}
    </>
  );
}
