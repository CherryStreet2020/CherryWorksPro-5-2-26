import { useState, useEffect } from "react";
import { Link } from "wouter";
import { ChevronDown, Lock, Megaphone } from "lucide-react";
import { MarketingOsUpgradeModal } from "@/components/marketing-os-upgrade-modal";
import {
  trackMarketingOsEvent,
  trackSectionShownOncePerSession,
} from "@/lib/marketing-os-telemetry";

/**
 * Sprint 2k — Always-on Marketing section for admins.
 *
 * Renders three visual variants in the same slot:
 *   - active / grace → identical to the previous Sprint 2i.3 behavior
 *     (group label + clickable Contacts/Companies children).
 *   - inactive       → Lock icon on the group label, muted+disabled
 *                      child rows (cursor-not-allowed, no `href`); the
 *                      entire group is one click target that opens the
 *                      upgrade modal. (Sprint 2n removed the inline
 *                      $99/mo price pill — pricing now lives only in
 *                      the upgrade modal and billing settings.)
 * Non-admins never reach this component (gated by the parent).
 */
export function MarketingNavSection({
  status,
  location,
}: {
  status: "active" | "inactive" | "grace";
  location: string;
}) {
  const isLocked = status === "inactive";
  const items: Array<{ title: string; url: string }> = [
    { title: "Contacts", url: "/marketing/contacts" },
    { title: "Companies", url: "/marketing/companies" },
    { title: "Tags", url: "/marketing/tags" },
    { title: "Segments", url: "/marketing/segments" },
    { title: "Campaigns", url: "/marketing/campaigns" },
    { title: "Sequences", url: "/marketing/sequences" },
    { title: "Activity", url: "/marketing/activity" },
    { title: "Import", url: "/marketing/contacts/import" },
  ];
  const isActive = (url: string) => location.startsWith(url);
  const hasActiveItem = !isLocked && items.some(i => isActive(i.url));
  const [open, setOpen] = useState(hasActiveItem || isLocked);
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    if (hasActiveItem) setOpen(true);
  }, [hasActiveItem]);

  useEffect(() => {
    if (isLocked) trackSectionShownOncePerSession();
  }, [isLocked]);

  if (!isLocked) {
    return (
      <div className="mb-1" data-testid="section-marketing-active">
        <button
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="w-full flex items-center justify-between px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 rounded-md transition-colors"
          style={{ color: "var(--lux-sidebar-section-color, var(--lux-text-muted))" }}
          data-testid="button-section-toggle-marketing"
        >
          Marketing
          <ChevronDown
            className="w-3 h-3 transition-transform duration-200"
            style={{ transform: open ? "rotate(0deg)" : "rotate(-90deg)" }}
          />
        </button>
        <div
          className="overflow-hidden transition-all duration-200 ease-in-out"
          style={{ maxHeight: open ? `${items.length * 44}px` : "0px", opacity: open ? 1 : 0, pointerEvents: open ? "auto" : "none" }}
        >
          {items.map(item => {
            const active = isActive(item.url);
            return (
              <Link
                key={item.title}
                href={item.url}
                data-testid={`link-${item.title.toLowerCase()}`}
                className={`flex items-center gap-2.5 px-3 py-2 mx-1 rounded-md text-sm no-underline cursor-pointer transition-colors ${active ? "font-semibold" : ""}`}
                style={{
                  color: active ? "var(--lux-sidebar-active-text, var(--lux-text))" : "var(--lux-text-secondary)",
                  background: active ? "var(--lux-sidebar-active-bg, hsl(var(--sidebar-accent)))" : "transparent",
                  display: "flex",
                }}
                onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.background = "var(--lux-sidebar-hover-bg, rgba(0,0,0,0.05))"; }}
                onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
              >
                <Megaphone className="w-4 h-4 flex-shrink-0" style={{ color: active ? "var(--lux-sidebar-active-text)" : "var(--lux-text-muted)" }} />
                <span className="flex-1">{item.title}</span>
              </Link>
            );
          })}
        </div>
      </div>
    );
  }

  const openModal = (source: string) => {
    trackMarketingOsEvent("marketing_os.discovery.modal_opened", { source });
    setModalOpen(true);
  };
  return (
    <div className="mb-1" data-testid="section-marketing-locked">
      <button
        type="button"
        onClick={() => openModal("section_label")}
        className="w-full flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 rounded-md transition-colors"
        style={{ color: "var(--lux-sidebar-section-color, var(--lux-text-muted))" }}
        data-testid="button-section-marketing-locked"
      >
        <span className="flex items-center gap-1.5 text-left">
          Marketing
          <Lock className="w-3 h-3" data-testid="icon-marketing-lock" aria-hidden="true" />
        </span>
      </button>
      <div className="overflow-hidden" style={{ maxHeight: `${items.length * 44}px`, opacity: 1 }}>
        {items.map(item => (
          <button
            type="button"
            key={item.title}
            onClick={() => openModal(`row_${item.title.toLowerCase()}`)}
            data-testid={`row-locked-${item.title.toLowerCase()}`}
            className="w-full flex items-center gap-2.5 px-3 py-2 mx-1 rounded-md text-sm transition-colors text-left"
            style={{
              color: "var(--lux-text-muted)",
              opacity: 0.6,
              cursor: "not-allowed",
              background: "transparent",
            }}
            title="Unlock Marketing OS to access this page"
          >
            <Megaphone className="w-4 h-4 flex-shrink-0" style={{ color: "var(--lux-text-muted)" }} />
            <span className="flex-1">{item.title}</span>
          </button>
        ))}
      </div>
      <MarketingOsUpgradeModal open={modalOpen} onOpenChange={setModalOpen} />
    </div>
  );
}
