import { createRoot, hydrateRoot } from "react-dom/client";
import { HelmetProvider } from "react-helmet-async";
import App from "./App";
import "./index.css";

window.addEventListener("error", (event) => {
  const msg = event.error?.message || event.message || "";
  if (/ChunkLoadError|Failed to fetch dynamically imported module|Loading chunk .* failed/.test(msg)) {
    const key = "chunk-reload-attempted";
    if (!sessionStorage.getItem(key)) {
      sessionStorage.setItem(key, "1");
      window.location.reload();
    }
  }
});

window.addEventListener("unhandledrejection", (event) => {
  const msg = event.reason?.message || String(event.reason || "");
  if (/ChunkLoadError|Failed to fetch dynamically imported module|Loading chunk .* failed/.test(msg)) {
    const key = "chunk-reload-attempted";
    if (!sessionStorage.getItem(key)) {
      sessionStorage.setItem(key, "1");
      window.location.reload();
    }
  }
});

const origPushState = history.pushState.bind(history);
history.pushState = function (...args: Parameters<typeof history.pushState>) {
  sessionStorage.removeItem("chunk-reload-attempted");
  return origPushState(...args);
};
window.addEventListener("popstate", () => {
  sessionStorage.removeItem("chunk-reload-attempted");
});

// Pre-rendered public pages (dist/prerendered, served by server/static.ts) arrive
// with markup in #root: hydrate it so React keeps the server HTML on screen while the
// page chunk loads. Recoverable hydration errors are recorded for the e2e gate —
// production React reports them as minified #418/#423/#425, so a message filter is
// not enough.
const rootEl = document.getElementById("root")!;
const tree = (
  <HelmetProvider>
    <App />
  </HelmetProvider>
);
if (rootEl.firstElementChild) {
  hydrateRoot(rootEl, tree, {
    onRecoverableError(err) {
      (window as unknown as { __hydrationErrors?: string[] }).__hydrationErrors ??= [];
      (window as unknown as { __hydrationErrors: string[] }).__hydrationErrors.push(String(err));
    },
  });
} else {
  createRoot(rootEl).render(tree);
}
