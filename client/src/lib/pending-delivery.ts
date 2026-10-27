/**
 * The server answers 409 `{ code: "PENDING_DELIVERY", pending }` when a delete
 * or step edit would touch sends the email provider has not confirmed yet.
 * `apiRequest` throws those as `Error("409: <body>")`.
 */
/** Pending count from a 409 PENDING_DELIVERY thrown by apiRequest, else null. */
export function pendingDeliveryCount(e: unknown): number | null {
  if (!(e instanceof Error) || !e.message.startsWith("409:")) return null;
  try {
    const body = JSON.parse(e.message.slice(4).trim());
    return body?.code === "PENDING_DELIVERY" ? Number(body.pending) || 1 : null;
  } catch {
    return null;
  }
}

export function pendingDeliveryMessage(e: unknown): string {
  const pending = pendingDeliveryCount(e);
  if (pending !== null) {
    return `${pending} email${pending === 1 ? " is" : "s are"} still being confirmed by the provider — try again in a few minutes.`;
  }
  return e instanceof Error ? e.message : "";
}
