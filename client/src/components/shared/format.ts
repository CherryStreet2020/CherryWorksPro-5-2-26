export function normalizeDate(dateStr: string): Date {
  if (dateStr && !dateStr.includes('T')) {
    return new Date(dateStr + 'T12:00:00');
  }
  return new Date(dateStr);
}

export function getCurrencySymbol(currencyCode: string = "USD"): string {
  try {
    const parts = new Intl.NumberFormat(undefined, { style: "currency", currency: currencyCode }).formatToParts(0);
    return parts.find(p => p.type === "currency")?.value || currencyCode;
  } catch {
    return currencyCode;
  }
}

export function formatMoney(value: number | string | null | undefined, currencyCode: string = "USD"): string {
  const num = Number(value);
  if (isNaN(num)) return "$0.00";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currencyCode,
      minimumFractionDigits: ["JPY", "KRW", "IDR", "CLP", "COP"].includes(currencyCode) ? 0 : 2,
      maximumFractionDigits: ["JPY", "KRW", "IDR", "CLP", "COP"].includes(currencyCode) ? 0 : 2,
    }).format(num);
  } catch {
    return `${currencyCode} ${num.toFixed(2)}`;
  }
}

export function formatRate(value: number | string | null | undefined, currencyCode: string = "USD"): string {
  return `${formatMoney(value, currencyCode)}/hr`;
}

export function formatNumber(value: number | string | null | undefined): string {
  const num = Number(value);
  if (isNaN(num)) return "0";
  return new Intl.NumberFormat(undefined).format(num);
}

export function formatHours(value: number | string | null | undefined): string {
  const num = Number(value);
  if (isNaN(num) || num === 0) return "0.00";
  return num.toFixed(2);
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value + (value.includes("T") ? "" : "T12:00:00"));
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function formatRelativeDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value + (value.includes("T") ? "" : "T00:00:00"));
  d.setHours(0, 0, 0, 0);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const diffDays = Math.round((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  return formatDate(value);
}

export function formatHoursMinutes(totalMinutes: number): string {
  const clamped = Math.max(0, totalMinutes);
  if (clamped === 0) return "0:00";
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}

export function formatPercent(value: number | string | null | undefined): string {
  const num = Number(value);
  if (isNaN(num)) return "0.0%";
  return `${num.toFixed(1)}%`;
}

export function formatTime12h(time: string | null | undefined): string {
  if (!time) return "";
  const [h, m] = time.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${hour12}:${String(m).padStart(2, "0")} ${period}`;
}
