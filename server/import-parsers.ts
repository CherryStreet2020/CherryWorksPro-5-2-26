const CSV_INJECTION_PATTERNS = [
  /^=/,
  /^\+/,
  /^-(?!\d)/,
  /^@/,
  /^\t/,
  /^cmd\s*\(/i,
  /^DDE\s*\(/i,
  /\|.*cmd/i,
  /\|.*powershell/i,
];

export function sanitizeCsvField(value: string): string {
  if (!value) return value;
  let s = value.replace(/^[=+@\t]+/, "");
  if (/^-(?!\d)/.test(s)) {
    s = s.replace(/^-+/, "");
  }
  for (const pattern of CSV_INJECTION_PATTERNS) {
    if (pattern.test(s)) {
      return "'" + s;
    }
  }
  return s;
}

export function sanitizeCsvOutput(value: string): string {
  if (!value) return value;
  const dangerous = /^[=+\-@\t\r]/.test(value) ||
    /\t|\r|\n/.test(value) ||
    /cmd\s*\(/i.test(value) ||
    /DDE\s*\(/i.test(value) ||
    /\|.*cmd/i.test(value) ||
    /\|.*powershell/i.test(value);
  if (dangerous) {
    return "'" + value.replace(/[\t\r\n]/g, " ");
  }
  return value;
}

export function parseAmount(raw: string, localeHint: "auto" | "en" | "eu" | "in" = "auto"): number {
  if (!raw || !raw.trim()) return NaN;
  let s = raw.trim();

  let negative = false;
  if (s.startsWith("(") && s.endsWith(")")) {
    negative = true;
    s = s.slice(1, -1).trim();
  }
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.substring(1).trim();
  }

  s = s.replace(/^[$€£¥₹₽R\s]+/, "");
  s = s.replace(/\u00A0/g, " ");

  const hasComma = s.includes(",");
  const hasDot = s.includes(".");
  const hasSpace = /\d\s\d/.test(s);

  if (hasSpace && !hasComma && hasDot) {
    s = s.replace(/\s/g, "");
  } else if (hasSpace && hasComma && !hasDot) {
    s = s.replace(/\s/g, "").replace(",", ".");
  } else if (hasSpace) {
    s = s.replace(/\s/g, "");
  }

  if (hasComma && hasDot) {
    const lastComma = s.lastIndexOf(",");
    const lastDot = s.lastIndexOf(".");

    if (lastComma > lastDot) {
      s = s.replace(/\./g, "").replace(",", ".");
    } else {
      s = s.replace(/,/g, "");
    }
  } else if (hasComma && !hasDot) {
    const parts = s.split(",");
    if (parts.length === 2 && parts[1].length <= 2) {
      if (localeHint === "en") {
        s = s.replace(/,/g, "");
      } else {
        s = s.replace(",", ".");
      }
    } else if (parts.length === 2 && parts[1].length === 3) {
      if (localeHint === "eu") {
        s = s.replace(",", ".");
      } else {
        s = s.replace(/,/g, "");
      }
    } else if (parts.length > 2) {
      const lastPart = parts[parts.length - 1];
      if (lastPart.length <= 2) {
        s = parts.slice(0, -1).join("") + "." + lastPart;
      } else {
        s = s.replace(/,/g, "");
      }
    }
  }

  s = s.replace(/\s/g, "");

  const num = Number(s);
  if (isNaN(num) || !isFinite(num)) return NaN;
  return negative ? -num : num;
}

const MONTH_MAP: Record<string, string> = {
  jan: "01", january: "01",
  feb: "02", february: "02",
  mar: "03", march: "03",
  apr: "04", april: "04",
  may: "05",
  jun: "06", june: "06",
  jul: "07", july: "07",
  aug: "08", august: "08",
  sep: "09", sept: "09", september: "09",
  oct: "10", october: "10",
  nov: "11", november: "11",
  dec: "12", december: "12",
};

export function parseDate(raw: string): string | null {
  if (!raw || !raw.trim()) return null;
  const s = raw.trim();

  const isoFull = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:T|$| )/);
  if (isoFull) {
    const [, y, m, d] = isoFull;
    if (isValidCalendarDate(+y, +m, +d)) return `${y}-${m}-${d}`;
    return null;
  }

  const namedMonth = s.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
  if (namedMonth) {
    const mon = MONTH_MAP[namedMonth[1].toLowerCase()];
    if (mon) {
      const day = namedMonth[2].padStart(2, "0");
      const year = namedMonth[3];
      if (isValidCalendarDate(+year, +mon, +day)) return `${year}-${mon}-${day}`;
    }
    return null;
  }

  const namedMonth2 = s.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (namedMonth2) {
    const mon = MONTH_MAP[namedMonth2[2].toLowerCase()];
    if (mon) {
      const day = namedMonth2[1].padStart(2, "0");
      const year = namedMonth2[3];
      if (isValidCalendarDate(+year, +mon, +day)) return `${year}-${mon}-${day}`;
    }
    return null;
  }

  const slashed = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (slashed) {
    const a = +slashed[1];
    const b = +slashed[2];
    const year = +slashed[3];
    if (a >= 1 && a <= 12 && b >= 1 && b <= 31 && isValidCalendarDate(year, a, b)) {
      return `${year}-${String(a).padStart(2, "0")}-${String(b).padStart(2, "0")}`;
    }
    if (b >= 1 && b <= 12 && a >= 1 && a <= 31 && isValidCalendarDate(year, b, a)) {
      return `${year}-${String(b).padStart(2, "0")}-${String(a).padStart(2, "0")}`;
    }
    return null;
  }

  const slashed2 = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2})$/);
  if (slashed2) {
    const a = +slashed2[1];
    const b = +slashed2[2];
    const shortYear = +slashed2[3];
    // Pivot year rule: 00-49 → 2000-2049, 50-99 → 1950-1999
    const year = shortYear >= 50 ? 1900 + shortYear : 2000 + shortYear;
    if (a >= 1 && a <= 12 && b >= 1 && b <= 31 && isValidCalendarDate(year, a, b)) {
      return `${year}-${String(a).padStart(2, "0")}-${String(b).padStart(2, "0")}`;
    }
    return null;
  }

  return null;
}

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (year < 1900 || year > 2100) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  const d = new Date(year, month - 1, day);
  return d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day;
}

export function parseHours(raw: string): number {
  if (!raw || !raw.trim()) return NaN;
  const s = raw.trim();

  const hms = s.match(/^(\d+):(\d{1,2}):(\d{1,2})$/);
  if (hms) {
    const h = parseInt(hms[1]);
    const m = parseInt(hms[2]);
    const sec = parseInt(hms[3]);
    return +(h + m / 60 + sec / 3600).toFixed(4);
  }

  const hm = s.match(/^(\d+):(\d{1,2})$/);
  if (hm) {
    const h = parseInt(hm[1]);
    const m = parseInt(hm[2]);
    return +(h + m / 60).toFixed(4);
  }

  const nhm = s.match(/^(\d+)\s*h(?:ours?)?(?:\s*(\d+)\s*m(?:in(?:utes?)?)?)?$/i);
  if (nhm) {
    const h = parseInt(nhm[1]);
    const m = parseInt(nhm[2] || "0");
    return +(h + m / 60).toFixed(4);
  }

  const mOnly = s.match(/^(\d+)\s*m(?:in(?:utes?)?)?$/i);
  if (mOnly) {
    return +(parseInt(mOnly[1]) / 60).toFixed(4);
  }

  const num = Number(s);
  if (isNaN(num)) return NaN;

  if (num > 24 && Number.isInteger(num)) {
    return +(num / 60).toFixed(4);
  }

  return num;
}
