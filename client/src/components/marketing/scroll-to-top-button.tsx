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
      className="fixed bottom-6 right-6 z-50 w-12 h-12 rounded-full flex items-center justify-center cursor-pointer transition-all hover:scale-110 shadow-lg"
      style={{
        background: "linear-gradient(135deg, #cf3339, #e74c3c)",
        boxShadow: "0 4px 20px rgba(207,51,57,0.4)",
      }}
      aria-label="Scroll to top"
      data-testid="button-scroll-to-top"
    >
      <ArrowUp className="w-5 h-5 text-white" />
    </button>
  );
}
