import { useEffect } from "react";
import { useLocation } from "wouter";

export function ScrollToTop() {
  const [location] = useLocation();

  useEffect(() => {
    let id = "";
    try { id = decodeURIComponent(window.location.hash.slice(1)); } catch { /* malformed hash: treat as none */ }
    if (!id) {
      window.scrollTo({ top: 0, behavior: "instant" });
      return;
    }
    // A client-side link to /page#section skips the browser's own jump, and a
    // lazy page may not have mounted yet, so look for the target for a moment.
    let frame = 0;
    const started = performance.now();
    const seek = () => {
      const target = document.getElementById(id);
      if (target) target.scrollIntoView({ behavior: "instant", block: "start" });
      else if (performance.now() - started < 5000) frame = requestAnimationFrame(seek);
    };
    seek();
    return () => cancelAnimationFrame(frame);
  }, [location]);

  return null;
}
