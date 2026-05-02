/**
 * Sprint 2d — Marketing OS tab strip.
 *
 * Pinned shared component rendered above /marketing/contacts,
 * /marketing/companies, and /marketing/tags. Sprint 2m: now composes the
 * premium `PillTab` primitive so the active tab matches the upgraded
 * Marketing OS visual language. Uses wouter's `useLocation` rather than a
 * local state value so the active tab stays correct across direct
 * navigations (e.g. browser back, deep link).
 */
import { useLocation } from "wouter";
import { PillTab } from "@/components/marketing-os/premium/pill-tab";

const TABS: ReadonlyArray<{ value: string; href: string; label: string }> = [
  { value: "contacts",  href: "/marketing/contacts",  label: "Contacts"  },
  { value: "companies", href: "/marketing/companies", label: "Companies" },
  { value: "tags",      href: "/marketing/tags",      label: "Tags"      },
  // Sprint 2e: Saved Segments — named, brand-scoped contact filter snapshots.
  { value: "segments",  href: "/marketing/segments",  label: "Segments"  },
  // Sprint 2f: Activity firehose — brand-scoped feed of every manual +
  // system contact-activity row, with delete + filter controls.
  { value: "activity",  href: "/marketing/activity",  label: "Activity"  },
  // Sprint 2n: campaign builder + sequence editor.
  { value: "campaigns", href: "/marketing/campaigns", label: "Campaigns" },
  { value: "sequences", href: "/marketing/sequences", label: "Sequences" },
];

export function MarketingOsTabs() {
  const [location, setLocation] = useLocation();
  const active =
    TABS.find((t) => location === t.href || location.startsWith(t.href + "/"))?.value
    ?? "contacts";

  return (
    <div className="mb-4" data-testid="nav-marketing-os-tabs">
      <PillTab
        items={TABS.map((t) => ({ value: t.value, label: t.label }))}
        value={active}
        onValueChange={(v) => {
          const target = TABS.find((t) => t.value === v);
          if (target) setLocation(target.href);
        }}
      />
    </div>
  );
}
