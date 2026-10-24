import { useState, useEffect } from "react";
import { ArrowUp } from "lucide-react";

export function ScrollToTopButton() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 500);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  if (!visible) return null;

  return (
    <button
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      // Stacked above the chat launcher (public/embed/chat.js: 56px at right/bottom 20px) so the two never overlap.
      className="fixed bottom-[88px] right-[26px] z-50 flex h-11 w-11 cursor-pointer items-center justify-center rounded-full bg-[#15171C] shadow-[0_4px_14px_rgba(21,23,28,0.25)] ring-1 ring-white/10 transition-colors hover:bg-[#2A2E37] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#CF3339]"
      aria-label="Scroll to top"
      data-testid="button-scroll-to-top"
    >
      <ArrowUp className="w-5 h-5 text-white" />
    </button>
  );
}
