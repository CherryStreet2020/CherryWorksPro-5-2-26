import { Link } from "wouter";
import { Users, FolderKanban, Tag, DollarSign, ClipboardCheck, ArrowRight, Briefcase } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useDocumentTitle } from "@/lib/use-document-title";
import { PageHelpLink } from "@/components/page-help-link";
import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import { useAuth } from "@/lib/auth";
import { useHubStats } from "@/lib/use-hub-stats";
import { HubCardStats, type HubCardStat } from "@/components/hub-card-stats";
import { formatMoney } from "@/components/shared/format";

interface HubLink {
  title: string;
  description: string;
  url: string;
  icon: LucideIcon;
  adminOnly?: boolean;
}

const LINKS: HubLink[] = [
  {
    title: "Clients",
    description: "Maintain client records, contacts, and engagement details.",
    url: "/clients",
    icon: Users,
  },
  {
    title: "Projects",
    description: "Plan engagements, assign teams, and track delivery.",
    url: "/projects",
    icon: FolderKanban,
  },
  {
    title: "Services",
    description: "Define the services you offer and their default rates.",
    url: "/services",
    icon: Tag,
  },
  {
    title: "Payouts",
    description: "Review and pay out earnings to team members.",
    url: "/payouts",
    icon: DollarSign,
    adminOnly: true,
  },
  {
    title: "Approvals",
    description: "Review pending time, expense, and document approvals.",
    url: "/approvals",
    icon: ClipboardCheck,
  },
];

export default function ManagementHubPage() {
  useDocumentTitle("Management");
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";
  const visibleLinks = LINKS.filter(l => !l.adminOnly || isAdmin);
  const { data: hubStats, isLoading: statsLoading } = useHubStats();

  const statsByUrl: Record<string, HubCardStat[]> = hubStats
    ? {
        "/clients": [{ value: String(hubStats.management.clients), label: "total", href: "/clients" }],
        "/projects": [{ value: String(hubStats.management.activeProjects), label: "active", href: "/projects?status=ACTIVE" }],
        "/services": [{ value: String(hubStats.management.services), label: "offered", href: "/services" }],
        "/approvals": [{ value: String(hubStats.management.approvalsPending), label: "pending", href: "/approvals?status=SUBMITTED" }],
        "/payouts": hubStats.management.payoutsThisMonth
          ? [
              { value: String(hubStats.management.payoutsThisMonth.count), label: "this month", href: "/payouts?status=COMPLETED" },
              { value: formatMoney(hubStats.management.payoutsThisMonth.amount), label: "paid out", href: "/payouts?status=COMPLETED" },
            ]
          : [],
      }
    : {};

  return (
    <div className="px-6 lg:px-8 xl:px-10 py-6 space-y-6">
      <PageBreadcrumbs page="Management" showDashboard={false} />
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: "linear-gradient(135deg, rgba(var(--lux-accent-rgb),0.15) 0%, rgba(var(--lux-accent-rgb),0.05) 100%)" }}>
          <Briefcase className="w-6 h-6" style={{ color: "var(--lux-accent)" }} />
        </div>
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight" style={{ color: "var(--lux-text)" }} data-testid="text-page-title">
              Management
            </h1>
            <PageHelpLink />
          </div>
          <p className="text-sm mt-0.5" style={{ color: "var(--lux-text-muted)" }}>
            Your operations hub — clients, projects, services, payouts, and approvals.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {visibleLinks.map(link => {
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
              data-testid={`link-management-${link.url.replace(/\//g, "-").replace(/^-/, "")}`}
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
                testIdPrefix={`management-${link.url.replace(/\//g, "-").replace(/^-/, "")}`}
              />
            </Link>
          );
        })}
      </div>
    </div>
  );
}
