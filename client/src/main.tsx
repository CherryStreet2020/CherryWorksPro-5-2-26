import { createRoot } from "react-dom/client";
import { HelmetProvider } from "react-helmet-async";
import App from "./App";
import "react-phone-number-input/style.css";
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

createRoot(document.getElementById("root")!).render(
  <HelmetProvider>
    <App />
  </HelmetProvider>
);
