interface DangerZoneProps {
  title?: string;
  description?: string;
  children: React.ReactNode;
}

export function DangerZone({ title = "Danger Zone", description, children }: DangerZoneProps) {
  return (
    <div
      className="rounded-lg border-2 p-4 mt-6 space-y-3"
      style={{
        borderColor: "rgba(239, 68, 68, 0.3)",
        background: "rgba(239, 68, 68, 0.03)",
      }}
      data-testid="danger-zone"
    >
      <h3 className="text-sm font-semibold text-red-500">{title}</h3>
      {description && (
        <p className="text-xs" style={{ color: "var(--lux-text-muted)" }}>
          {description}
        </p>
      )}
      <div>{children}</div>
    </div>
  );
}
