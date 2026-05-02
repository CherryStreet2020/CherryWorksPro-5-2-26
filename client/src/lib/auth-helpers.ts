export type UserRole = "ADMIN" | "MANAGER" | "TEAM_MEMBER";

export function isAdmin(user: { role?: string } | null | undefined): boolean {
  return user?.role === "ADMIN";
}

export function canManage(user: { role?: string } | null | undefined): boolean {
  return user?.role === "ADMIN" || user?.role === "MANAGER";
}

export function roleLabel(role: string | undefined): string {
  if (role === "ADMIN") return "Admin";
  if (role === "MANAGER") return "Manager";
  return "Team Member";
}
