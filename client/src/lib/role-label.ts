export function roleLabel(role: string): string {
  switch (role?.toUpperCase()) {
    case "ADMIN":
      return "Admin";
    case "MANAGER":
      return "Manager";
    case "TEAM_MEMBER":
      return "Team Member";
    default:
      return role || "Team Member";
  }
}
