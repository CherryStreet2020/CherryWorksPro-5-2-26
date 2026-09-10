/**
 * Help panel open bus. The panel is a lazy chunk, so a request that arrives before it
 * has mounted is kept and delivered on subscribe — the first Help click after sign-in is
 * never lost.
 */
const HELP_PANEL_OPEN_EVENT = "help-panel:open";
let subscribers = 0;
let pending = false;

export function openHelpPanel() {
  if (subscribers === 0) { pending = true; return; }
  document.dispatchEvent(new CustomEvent(HELP_PANEL_OPEN_EVENT));
}

/** Called by the panel on mount; returns the unsubscribe. Delivers a queued open request. */
export function subscribeHelpPanelOpen(handler: () => void): () => void {
  document.addEventListener(HELP_PANEL_OPEN_EVENT, handler);
  subscribers += 1;
  if (pending) { pending = false; queueMicrotask(handler); }
  return () => { subscribers -= 1; document.removeEventListener(HELP_PANEL_OPEN_EVENT, handler); };
}

export { HELP_PANEL_OPEN_EVENT };
