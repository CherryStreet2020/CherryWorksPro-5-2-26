import { Link } from "wouter";
import { Settings, Upload, Plug2, CalendarCheck, ArrowRight } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useDocumentTitle } from "@/lib/use-document-title";
import { PageHelpLink } from "@/components/page-help-link";
import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import { useHubStats } from "@/lib/use-hub-stats";
import { HubCardStats, type HubCardStat } from "@/components/hub-card-stats";
import { formatDate } from "@/components/shared/format";

interface HubLink {
  title: string;
  description: string;
  url: string;
  icon: LucideIcon;
}

const LINKS: HubLink[] = [
  {
    title: "Settings",
    description: "Configure your firm profile, branding, and workspace preferences.",
    url: "/settings",
    icon: Settings,
  },
  {
    title: "Import",
    description: "Bring in clients, projects, and historical data from other tools.",
    url: "/import",
    icon: Upload,
  },
  {
    title: "API & Integrations",
    description: "Connect Cherry to other apps and manage API access keys.",
    url: "/api-integrations",
    icon: Plug2,
  },
  {
    title: "Close Periods",
    description: "Lock fiscal periods to prevent edits to historical books.",
    url: "/close-periods",
    icon: CalendarCheck,
  },
];

export default function SystemHubPage() {
  useDocumentTitle("System");
  const { data: hubStats, isLoading: statsLoading } = useHubStats();

  const statsByUrl: Record<string, HubCardStat[]> = hubStats
    ? {
        "/api-integrations":
          hubStats.system.apiKeys !== null
            ? [
                { value: String(hubStats.system.apiKeys), label: "API keys", href: "/api-integrations" },
                ...(hubStats.system.webhooksActive !== null
                  ? [{ value: String(hubStats.system.webhooksActive), label: "active webhooks", href: "/api-integrations" }]
                  : []),
              ]
            : [],
        "/close-periods": [
          {
            value: hubStats.system.lastClosedPeriod
              ? formatDate(hubStats.system.lastClosedPeriod)
              : "Never",
            label: "last closed",
            href: "/close-periods",
          },
        ],
        "/settings": [
          { value: String(hubStats.system.teamMembers), label: "team members", href: "/team" },
        ],
        "/import": [
          {
            value: hubStats.system.lastImport
              ? formatDate(hubStats.system.lastImport)
              : "Never",
            label: "last import",
            href: "/import",
          },
        ],
      }
    : {};

  return (
    <div className="px-6 lg:px-8 xl:px-10 py-6 space-y-6">
      <PageBreadcrumbs page="System" showDashboard={false} />
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: "linear-gradient(135deg, rgba(var(--lux-accent-rgb),0.15) 0%, rgba(var(--lux-accent-rgb),0.05) 100%)" }}>
          <Settings className="w-6 h-6" style={{ color: "var(--lux-accent)" }} />
        </div>
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight" style={{ color: "var(--lux-text)" }} data-testid="text-page-title">
              System
            </h1>
            <PageHelpLink />
          </div>
          <p className="text-sm mt-0.5" style={{ color: "var(--lux-text-muted)" }}>
            Workspace configuration — settings, imports, integrations, and period close.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {LINKS.map(link => {
          const Icon = link.icon;
          return (
            <Link
              key={link.url}
              href={link.url}
              className="group block rounded-xl p-5 border no-underline transition-all hover:-translate-y-0.5"
              style={{
                background: "var(--lux-surface)",
                borderColor: "var(--lux-border)",
                boxShadow: "var(--lux-card-shadow)",
                color: "var(--lux-text)",
              }}
              data-testid={`link-system-${link.url.replace(/\//g, "-").replace(/^-/, "")}`}
            >
              <div className="flex items-start justify-between">
                <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: "rgba(var(--lux-accent-rgb),0.10)" }}>
                  <Icon className="w-5 h-5" style={{ color: "var(--lux-accent)" }} />
                </div>
                <ArrowRight className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: "var(--lux-text-muted)" }} />
              </div>
              <h2 className="mt-4 text-base font-semibold" style={{ color: "var(--lux-text)" }}>
                {link.title}
              </h2>
              <p className="mt-1 text-sm" style={{ color: "var(--lux-text-muted)" }}>
                {link.description}
              </p>
              <HubCardStats
                isLoading={statsLoading}
                stats={statsByUrl[link.url] ?? []}
                testIdPrefix={`system-${link.url.replace(/\//g, "-").replace(/^-/, "")}`}
              />
            </Link>
          );
        })}
      </div>
    </div>
  );
}
