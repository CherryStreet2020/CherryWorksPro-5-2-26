export function maskEmail(email: string): string {
  if (!email || !email.includes("@")) return "***";
  const [local, domain] = email.split("@");
  const masked = local.length <= 2
    ? local[0] + "***"
    : local[0] + "***" + local[local.length - 1];
  return `${masked}@${domain}`;
}
