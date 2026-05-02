import { useEffect } from "react";
import { useLocation } from "wouter";

export function ScrollToTop() {
  const [location] = useLocation();

  useEffect(() => {
    if (window.location.hash) return;
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [location]);

  return null;
}
