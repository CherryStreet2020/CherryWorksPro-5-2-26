/**
 * InlineEditableField — Sprint 2m premium primitive.
 *
 * Display text → click to edit → save on blur or Enter, cancel on
 * Escape. Outline invisible at idle, soft on hover, accent on edit.
 *
 * Theme behaviour: Idle/hover/edit outline uses `--lux-border` and
 * `--lux-accent` tokens that already flip via `.dark`. The edit-mode
 * focus indicator uses `box-shadow: 0 0 0 2px
 * rgba(var(--lux-accent-rgb), 0.25)` directly on `:focus-visible`
 * (never `var(--lux-focus-ring)`).
 */
import * as React from "react";
import { cn } from "@/lib/utils";

export interface InlineEditableFieldProps {
  value: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
}

export function InlineEditableField({
  value,
  onChange,
  placeholder = "Click to edit",
  className,
  ariaLabel,
}: InlineEditableFieldProps) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(value);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (editing) {
      setDraft(value);
      requestAnimationFrame(() => inputRef.current?.select());
    }
  }, [editing, value]);

  const commit = () => {
    if (draft !== value) onChange?.(draft);
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setEditing(false);
        }}
        aria-label={ariaLabel ?? placeholder}
        className={cn(
          "rounded-md border bg-transparent px-2 py-1 text-sm outline-none focus-visible:outline-none focus-visible:shadow-[0_0_0_2px_rgba(var(--lux-accent-rgb),0.25)]",
          className,
        )}
        style={{
          color: "var(--lux-text)",
          borderColor: "var(--lux-accent)",
          boxShadow: "0 0 0 2px rgba(var(--lux-accent-rgb), 0.25)",
        }}
        data-testid="inline-editable-input"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className={cn(
        "group inline-flex items-center rounded-md border border-transparent px-2 py-1 text-sm text-left transition-all duration-150 ease-out hover:border-[var(--lux-border)]",
        "focus-visible:outline-none focus-visible:shadow-[0_0_0_2px_rgba(var(--lux-accent-rgb),0.25)]",
        className,
      )}
      style={{ color: value ? "var(--lux-text)" : "var(--lux-text-muted)" }}
      aria-label={ariaLabel ?? placeholder}
      data-testid="inline-editable-trigger"
    >
      {value || placeholder}
    </button>
  );
}

export default InlineEditableField;
