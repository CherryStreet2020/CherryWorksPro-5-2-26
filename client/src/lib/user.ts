export function displayName(u: { firstName?: string | null; lastName?: string | null; name?: string | null }): string {
  const fn = u.firstName?.trim();
  const ln = u.lastName?.trim();
  if (fn || ln) return [fn, ln].filter(Boolean).join(" ");
  return u.name?.trim() || "";
}

export function userInitials(u: { firstName?: string | null; lastName?: string | null; name?: string | null }): string {
  const fn = u.firstName?.trim();
  const ln = u.lastName?.trim();
  if (fn || ln) {
    return [(fn || "")[0], (ln || "")[0]].filter(Boolean).join("").toUpperCase();
  }
  return (u.name || "?").split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase();
}
