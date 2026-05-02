interface AddressDisplayProps {
  value?: string | null;
  street?: string | null;
  suite?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  country?: string | null;
}

export function AddressDisplay({ value, street, suite, city, state, zip, country }: AddressDisplayProps) {
  const hasStructured = !!(street || suite || city || state || zip || country);

  if (hasStructured) {
    const line1 = [street, suite].filter(Boolean).join(", ");
    const line2 = [city, state, zip].filter(Boolean).join(", ");
    const line3 = country || "";
    const lines = [line1, line2, line3].filter(Boolean);

    if (lines.length === 0) return <span style={{ color: "var(--lux-text-muted)" }}>—</span>;

    return (
      <div className="text-sm leading-relaxed" style={{ color: "var(--lux-text-secondary)" }}>
        {lines.map((line, i) => (
          <div key={i}>{line}</div>
        ))}
      </div>
    );
  }

  if (!value) return <span style={{ color: "var(--lux-text-muted)" }}>—</span>;

  const lines = value.split(",").map((l) => l.trim()).filter(Boolean);

  return (
    <div className="text-sm leading-relaxed" style={{ color: "var(--lux-text-secondary)" }}>
      {lines.map((line, i) => (
        <div key={i}>{line}</div>
      ))}
    </div>
  );
}
