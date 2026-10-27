/**
 * Refusal raised by storage when a delete or a step replacement would touch
 * a campaign / sequence / enrollment that still has an ACS operation the
 * provider has not confirmed (`accepted` attempt). Deleting would erase the
 * row the reconciler needs; replacing steps would let a later `success`
 * advance an enrollment past a different, unsent message (PLAN §4a, §4b).
 * Lasts at most until resolution (24 h guard).
 */
export class PendingDeliveryError extends Error {
  readonly code = "PENDING_DELIVERY";
  constructor(readonly pending: number) {
    super(
      `This item has ${pending} email${pending === 1 ? "" : "s"} still being confirmed by the provider; ` +
      "try again in a few minutes (at most 24 hours).",
    );
    this.name = "PendingDeliveryError";
  }
}
