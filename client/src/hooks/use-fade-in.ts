import { useEffect, useRef } from "react";

/**
 * Reveal-on-scroll for marketing sections. The CSS keeps `.fade-in-section` visible
 * until <html> carries `js-ready`, so pre-rendered pages read without JavaScript.
 * On mount, a section already in the viewport is marked visible BEFORE `js-ready`
 * is set — both happen in the same effect flush, before the next paint — so
 * above-the-fold content never flickers; sections below the fold animate in when
 * they scroll into view, as before.
 */
export function useFadeIn<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const inView = el.getBoundingClientRect().top < window.innerHeight;
    if (inView) el.classList.add("fade-in-visible");
    document.documentElement.classList.add("js-ready");
    if (inView) return;
    const obs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { el.classList.add("fade-in-visible"); obs.disconnect(); }
    }, { threshold: 0.12 });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return ref;
}
