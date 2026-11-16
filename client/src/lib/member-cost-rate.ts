// Cost rate (what we pay a person per hour) when adding them to a project.
//
// A person's profile can hold a default hourly pay rate. When the cost-rate box
// is left empty, the server falls back to that default, so the screens must send
// nothing rather than "0". Picking a person pre-fills the box with their default
// so it is visible before saving.

/** The person's default hourly pay rate, or "" when none is set or it can't be read. */
export async function fetchDefaultCostRate(userId: string): Promise<string> {
  if (!userId) return "";
  try {
    const res = await fetch(`/api/team/${userId}/payroll-config`, { credentials: "include" });
    if (!res.ok) return "";
    const data = await res.json();
    const rate = Number(data?.hourlyPayRate);
    return rate > 0 ? rate.toFixed(2) : "";
  } catch {
    return "";
  }
}

/** The value to send as costRateHourly: a number, or undefined (left empty) so the server uses the default. */
export function costRateForSubmit(value: string | null | undefined): number | undefined {
  if (value == null || String(value).trim() === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}
