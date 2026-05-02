import { formatDate, formatRelativeDate } from "./format";

interface DateDisplayProps {
  value: string | null | undefined;
  relative?: boolean;
}

export function DateDisplay({ value, relative = false }: DateDisplayProps) {
  const formatted = relative ? formatRelativeDate(value) : formatDate(value);

  return (
    <span className="text-sm whitespace-nowrap" style={{ color: "var(--lux-text-secondary)" }}>
      {formatted}
    </span>
  );
}
