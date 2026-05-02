import { formatMoney } from "./format";

interface MoneyDisplayProps {
  value: number | string | null | undefined;
  currency?: string;
  color?: "auto" | "positive" | "negative" | "neutral";
  size?: "xs" | "sm" | "lg";
}

export function MoneyDisplay({ value, currency = "USD", color = "neutral", size = "sm" }: MoneyDisplayProps) {
  const num = Number.isFinite(Number(value)) ? Number(value) : 0;

  let colorStyle: string;
  if (color === "auto") {
    colorStyle = num > 0 ? "#22c55e" : num < 0 ? "#ef4444" : "var(--lux-text-muted)";
  } else if (color === "positive") {
    colorStyle = "#22c55e";
  } else if (color === "negative") {
    colorStyle = "#ef4444";
  } else {
    colorStyle = "inherit";
  }

  const sizeClasses = size === "xs"
    ? "text-xs"
    : size === "lg"
      ? "text-xl font-bold"
      : "text-sm font-medium";

  return (
    <span
      className={`${sizeClasses} tabular-nums`}
      style={{ color: colorStyle, fontVariantNumeric: "tabular-nums" }}
    >
      {formatMoney(num, currency)}
    </span>
  );
}
