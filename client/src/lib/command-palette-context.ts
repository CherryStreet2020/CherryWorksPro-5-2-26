/**
 * Command palette open bus, same shape as help-context: the palette is a lazy chunk, so an
 * open request before it mounts is queued and delivered on subscribe.
 */
const EVENT = "command-palette:open";
let subscribers = 0;
let pending = false;

export function openCommandPalette() {
  if (subscribers === 0) { pending = true; return; }
  document.dispatchEvent(new CustomEvent(EVENT));
}

export function subscribeCommandPaletteOpen(handler: () => void): () => void {
  document.addEventListener(EVENT, handler);
  subscribers += 1;
  if (pending) { pending = false; queueMicrotask(handler); }
  return () => { subscribers -= 1; document.removeEventListener(EVENT, handler); };
}
