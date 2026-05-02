import { Link } from "wouter";
import { BookOpen, Landmark, BookMarked, Scale, Building2, ArrowRight } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useDocumentTitle } from "@/lib/use-document-title";
import { PageHelpLink } from "@/components/page-help-link";
import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import { useAuth } from "@/lib/auth";
import { useHubStats } from "@/lib/use-hub-stats";
import { HubCardStats, type HubCardStat } from "@/components/hub-card-stats";

interface HubLink {
  title: string;
  description: string;
  url: string;
  icon: LucideIcon;
  adminOnly?: boolean;
}

const LINKS: HubLink[] = [
  {
    title: "Chart of Accounts",
    description: "Manage the accounts that organize every transaction in your books.",
    url: "/gl/accounts",
    icon: BookOpen,
  },
  {
    title: "General Ledger",
    description: "Browse account activity with date filters and expandable detail.",
    url: "/gl/ledger",
    icon: Landmark,
  },
  {
    title: "Journal Entries",
    description: "Review auto-generated entries or post manual journals.",
    url: "/gl/journal-entries",
    icon: BookMarked,
  },
  {
    title: "Trial Balance",
    description: "Verify your books balance as of any date and export to CSV.",
    url: "/gl/trial-balance",
    icon: Scale,
  },
  {
    title: "Banking",
    description: "Connect bank feeds and reconcile statements against your ledger.",
    url: "/banking",
    icon: Building2,
    adminOnly: true,
  },
];

export default function AccountingHubPage() {
  useDocumentTitle("Accounting");
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";
  const visibleLinks = LINKS.filter(l => !l.adminOnly || isAdmin);
  const { data: hubStats, isLoading: statsLoading } = useHubStats();

  const todayLabel = new Date().toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });

  const statsByUrl: Record<string, HubCardStat[]> = hubStats
    ? {
        "/gl/accounts": [{ value: String(hubStats.accounting.glAccounts), label: "accounts", href: "/gl/accounts" }],
        "/gl/journal-entries": [
          { value: String(hubStats.accounting.journalEntriesThisMonth), label: "this month", href: "/gl/journal-entries?period=this-month" },
        ],
        "/banking":
          hubStats.accounting.bankingConnections !== null
            ? [{ value: String(hubStats.accounting.bankingConnections), label: "connections", href: "/banking" }]
            : [],
        "/gl/ledger": [
          { value: String(hubStats.accounting.glAccounts), label: "accounts to browse", href: "/gl/ledger" },
        ],
        "/gl/trial-balance": [{ value: todayLabel, label: "as of today", href: "/gl/trial-balance" }],
      }
    : {};

  return (
    <div className="px-6 lg:px-8 xl:px-10 py-6 space-y-6">
      <PageBreadcrumbs page="Accounting" showDashboard={false} />
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: "linear-gradient(135deg, rgba(var(--lux-accent-rgb),0.15) 0%, rgba(var(--lux-accent-rgb),0.05) 100%)" }}>
          <BookOpen className="w-6 h-6" style={{ color: "var(--lux-accent)" }} />
        </div>
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight" style={{ color: "var(--lux-text)" }} data-testid="text-page-title">
              Accounting
            </h1>
            <PageHelpLink />
          </div>
          <p className="text-sm mt-0.5" style={{ color: "var(--lux-text-muted)" }}>
            Your General Ledger hub — chart of accounts, journals, ledger, and reports.
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
              data-testid={`link-accounting-${link.url.replace(/\//g, "-").replace(/^-/, "")}`}
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
                testIdPrefix={`accounting-${link.url.replace(/\//g, "-").replace(/^-/, "")}`}
              />
            </Link>
          );
        })}
      </div>
    </div>
  );
}
