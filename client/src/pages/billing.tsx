import { Link } from "wouter";
import { FileText, FileCheck, CreditCard, ArrowRight } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useDocumentTitle } from "@/lib/use-document-title";
import { PageHelpLink } from "@/components/page-help-link";
import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import { useHubStats } from "@/lib/use-hub-stats";
import { HubCardStats, type HubCardStat } from "@/components/hub-card-stats";
import { formatMoney } from "@/components/shared/format";

interface HubLink {
  title: string;
  description: string;
  url: string;
  icon: LucideIcon;
}

const LINKS: HubLink[] = [
  {
    title: "Invoices",
    description: "Create, send, and track invoices to get paid faster.",
    url: "/invoices",
    icon: FileText,
  },
  {
    title: "Estimates",
    description: "Draft estimates and convert approved quotes into invoices.",
    url: "/estimates",
    icon: FileCheck,
  },
  {
    title: "Payments",
    description: "Record payments and reconcile what's been collected.",
    url: "/payments",
    icon: CreditCard,
  },
];

export default function BillingHubPage() {
  useDocumentTitle("Billing");
  const { data: hubStats, isLoading: statsLoading } = useHubStats();

  const statsByUrl: Record<string, HubCardStat[]> = {
    "/invoices": hubStats
      ? [
          { value: String(hubStats.billing.invoicesOpen), label: "open", href: "/invoices?status=OPEN" },
          { value: formatMoney(hubStats.billing.invoicesOpenAmount), label: "outstanding", href: "/invoices?status=OPEN" },
        ]
      : [],
    "/estimates": hubStats
      ? [{ value: String(hubStats.billing.estimatesPending), label: "pending", href: "/estimates?status=SENT" }]
      : [],
    "/payments": hubStats
      ? [
          { value: String(hubStats.billing.paymentsThisMonth), label: "this month", href: "/payments?period=this-month" },
          { value: formatMoney(hubStats.billing.paymentsThisMonthAmount), label: "collected", href: "/payments?period=this-month" },
        ]
      : [],
  };

  return (
    <div className="px-6 lg:px-8 xl:px-10 py-6 space-y-6">
      <PageBreadcrumbs page="Billing" showDashboard={false} />
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: "linear-gradient(135deg, rgba(var(--lux-accent-rgb),0.15) 0%, rgba(var(--lux-accent-rgb),0.05) 100%)" }}>
          <FileText className="w-6 h-6" style={{ color: "var(--lux-accent)" }} />
        </div>
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight" style={{ color: "var(--lux-text)" }} data-testid="text-page-title">
              Billing
            </h1>
            <PageHelpLink />
          </div>
          <p className="text-sm mt-0.5" style={{ color: "var(--lux-text-muted)" }}>
            Your billing hub — invoices, estimates, and payments in one place.
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
              data-testid={`link-billing-${link.url.replace(/\//g, "-").replace(/^-/, "")}`}
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
                testIdPrefix={`billing-${link.url.replace(/\//g, "-").replace(/^-/, "")}`}
              />
            </Link>
          );
        })}
      </div>
    </div>
  );
}
