/**
 * Marketing OS — Sprint 2b: Companies list (/marketing/companies).
 *
 * Mirrors contacts.tsx layout/conventions. Brand-scoped via BrandContext.
 * Add Company is a colocated dialog (matches contacts pattern).
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Plus, Search, X, Building2, ChevronRight } from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useBrand } from "@/hooks/useBrand";
import { isMarketingOsEnabled } from "@/lib/featureFlags";
import { Card, CardContent } from "@/components/ui/card";
import { SectionCard } from "@/components/marketing-os/premium/section-card";
import { PremiumDialog } from "@/components/marketing-os/premium/premium-dialog";
import { Filter as FilterIcon, Building as BuildingIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import type { Company, Brand } from "@shared/schema";
import { MarketingOsTabs } from "@/components/marketing-os/marketing-os-tabs";
import { BrandBadge } from "@/components/marketing-os/brand-badge";

type CompanyRow = Company & { contactsCount: number };

export default function CompaniesListPage() {
  const flagOn = isMarketingOsEnabled();
  const { toast } = useToast();
  const { activeBrand, brands, setActiveBrand } = useBrand();

  const [searchTerm, setSearchTerm] = useState("");
  const [deletedFilter, setDeletedFilter] = useState<"exclude" | "only" | "all">("exclude");
  const PAGE_SIZE = 50;
  const [pages, setPages] = useState(1);

  const brandId = activeBrand?.id ?? null;

  useEffect(() => { setPages(1); }, [brandId, searchTerm, deletedFilter]);

  const { data: rows = [], isLoading } = useQuery<CompanyRow[]>({
    queryKey: ["/api/marketing/companies", brandId, searchTerm, deletedFilter, pages],
    enabled: flagOn,
    queryFn: async () => {
      const sp = new URLSearchParams();
      if (brandId) sp.set("brandId", brandId);
      if (searchTerm.trim()) sp.set("q", searchTerm.trim());
      if (deletedFilter !== "exclude") sp.set("deleted", deletedFilter);
      sp.set("limit", String(PAGE_SIZE * pages));
      const res = await fetch(`/api/marketing/companies?${sp.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      return json.rows as CompanyRow[];
    },
  });

  const hasMore = rows.length === PAGE_SIZE * pages;

  if (!flagOn) {
    return (
      <div className="p-10 text-center text-sm" style={{ color: "var(--lux-text-muted)" }} data-testid="status-flag-off">
        Marketing is available on the Business plan. Upgrade anytime from Settings → Plan.
      </div>
    );
  }

  if (brands && brands.length === 0) {
    return (
      <div className="px-6 lg:px-8 xl:px-10 py-6 max-w-3xl mx-auto">
        <Card className="border-0" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }}>
          <CardContent className="p-12 text-center" data-testid="empty-state-no-brands">
            <Building2 className="w-10 h-10 mx-auto mb-4" style={{ color: "var(--lux-text-muted)" }} />
            <h2 className="text-lg font-semibold mb-2" style={{ color: "var(--lux-text)" }}>Create a brand first</h2>
            <p className="text-sm mb-6" style={{ color: "var(--lux-text-muted)" }}>
              Companies are organized by brand. Create at least one brand before adding companies.
            </p>
            <Button asChild data-testid="link-create-brand">
              <Link href="/settings/brands">Go to Brands</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Sprint 2f.1: explicit "select a brand" guard mirrors contacts.tsx /
  // tags.tsx / segments.tsx. Retires the previous "All brands" affordance
  // — every Marketing OS list is brand-isolated by design (R4/R5).
  if (brands && brands.length > 0 && !activeBrand) {
    return (
      <div className="px-6 lg:px-8 xl:px-10 py-6 max-w-3xl mx-auto">
        <Card className="border-0" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }}>
          <CardContent className="p-12 text-center" data-testid="empty-state-select-brand">
            <Building2 className="w-10 h-10 mx-auto mb-4" style={{ color: "var(--lux-text-muted)" }} />
            <h2 className="text-lg font-semibold mb-2" style={{ color: "var(--lux-text)" }}>Select a brand to view companies</h2>
            <p className="text-sm mb-6" style={{ color: "var(--lux-text-muted)" }}>
              Use the brand picker in the top bar to choose which brand's companies to manage.
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {brands.map((b) => (
                <Button key={b.id} variant="outline" onClick={() => setActiveBrand(b.id)} data-testid={`button-pick-brand-${b.id}`}>
                  {b.name}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="px-6 lg:px-8 xl:px-10 py-6 max-w-7xl mx-auto">
      <MarketingOsTabs />
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--lux-text)" }} data-testid="text-page-title">Companies</h1>
          <div className="mt-1">
            <BrandBadge />
          </div>
        </div>
        <AddCompanyButton brandId={brandId} brands={brands ?? []} />
      </div>

      <SectionCard
        icon={<FilterIcon className="w-4 h-4" />}
        title="Filters"
        subtitle="Search and narrow the company list"
        className="mb-4"
      >
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[220px]">
            <Label htmlFor="companies-search">Search</Label>
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--lux-text-muted)" }} />
              <Input
                id="companies-search"
                placeholder="Name or domain…"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9"
                data-testid="input-search-companies"
              />
            </div>
          </div>

          {/*
            Sprint 2f.1: editable Brand <Select> retired here, plus the
            "All brands" affordance retired (every Marketing OS list is
            brand-isolated by design). The global topbar BrandSwitcher is
            the single source of truth — see R4/R5.
          */}

          <div className="min-w-[160px]">
            <Label>Show</Label>
            <Select value={deletedFilter} onValueChange={(v) => setDeletedFilter(v as any)}>
              <SelectTrigger data-testid="select-deleted-filter"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="exclude">Active</SelectItem>
                <SelectItem value="only">Deleted only</SelectItem>
                <SelectItem value="all">All</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {searchTerm && (
            <Button variant="ghost" size="sm" onClick={() => setSearchTerm("")} data-testid="button-clear-filters" className="self-end mb-1">
              <X className="w-3.5 h-3.5 mr-1" />Clear
            </Button>
          )}
        </div>
      </SectionCard>

      <Card className="border-0" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }}>
        <CardContent className="p-0 overflow-x-auto">
          {isLoading ? (
            <div className="p-8 text-sm" style={{ color: "var(--lux-text-muted)" }} data-testid="status-loading">Loading companies…</div>
          ) : rows.length === 0 ? (
            <div className="text-center py-16" data-testid="empty-state-companies">
              <Building2 className="w-10 h-10 mx-auto mb-3" style={{ color: "var(--lux-text-muted)" }} />
              <p className="text-base mb-1" style={{ color: "var(--lux-text)" }}>No companies yet</p>
              <p className="text-sm" style={{ color: "var(--lux-text-muted)" }}>
                Add a company manually, or one will be created automatically when you save a contact with a work email.
              </p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead style={{ borderBottom: "1px solid var(--lux-border)" }}>
                <tr>
                  <th className="px-4 py-2 text-left font-medium" style={{ color: "var(--lux-text-muted)" }}>Name</th>
                  <th className="px-4 py-2 text-left font-medium" style={{ color: "var(--lux-text-muted)" }}>Domain</th>
                  <th className="px-4 py-2 text-left font-medium" style={{ color: "var(--lux-text-muted)" }}>Industry</th>
                  <th className="px-4 py-2 text-left font-medium" style={{ color: "var(--lux-text-muted)" }}>Size</th>
                  <th className="px-4 py-2 text-left font-medium" style={{ color: "var(--lux-text-muted)" }}>Source</th>
                  <th className="px-4 py-2 text-right font-medium" style={{ color: "var(--lux-text-muted)" }}>Contacts</th>
                  <th className="px-4 py-2 w-10"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr
                    key={c.id}
                    className="hover:bg-[var(--lux-bg)] transition-colors"
                    style={{ borderBottom: "1px solid var(--lux-border)" }}
                    data-testid={`row-company-${c.id}`}
                  >
                    <td className="px-4 py-2">
                      <Link
                        href={`/marketing/companies/${c.id}`}
                        className="font-medium hover:underline"
                        style={{ color: "var(--lux-text)" }}
                        data-testid={`link-company-name-${c.id}`}
                      >
                        {c.name}
                      </Link>
                      {c.deletedAt && (
                        <span className="ml-2 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded" style={{ background: "var(--lux-border)", color: "var(--lux-text-muted)" }} data-testid={`badge-deleted-${c.id}`}>
                          Deleted
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2" style={{ color: "var(--lux-text-muted)" }} data-testid={`text-domain-${c.id}`}>{c.domain || "—"}</td>
                    <td className="px-4 py-2" style={{ color: "var(--lux-text-muted)" }} data-testid={`text-industry-${c.id}`}>{c.industry || "—"}</td>
                    <td className="px-4 py-2" style={{ color: "var(--lux-text-muted)" }} data-testid={`text-size-${c.id}`}>{c.sizeBand || "—"}</td>
                    <td className="px-4 py-2" style={{ color: "var(--lux-text-muted)" }} data-testid={`text-source-${c.id}`}>{c.source || "—"}</td>
                    <td className="px-4 py-2 text-right" style={{ color: "var(--lux-text)" }} data-testid={`text-contacts-count-${c.id}`}>{c.contactsCount}</td>
                    <td className="px-4 py-2">
                      <Link href={`/marketing/companies/${c.id}`} data-testid={`link-company-detail-${c.id}`}>
                        <ChevronRight className="w-4 h-4" style={{ color: "var(--lux-text-muted)" }} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
        {hasMore && (
          <div className="p-3 text-center" style={{ borderTop: "1px solid var(--lux-border)" }}>
            <Button variant="ghost" size="sm" onClick={() => setPages((p) => p + 1)} data-testid="button-load-more">Load more</Button>
          </div>
        )}
      </Card>
    </div>
  );
}

function AddCompanyButton({ brandId, brands }: { brandId: string | null; brands: Brand[] }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // Sprint 2f.2 (Task #72): the create dialog defaults-and-locks to the
  // currently active brand. Mirrors the read-only brand chip on the list
  // filters and prevents users from silently creating a company under a
  // brand they aren't viewing. Switch brands via the BrandSwitcher to
  // create under a different brand.
  const [form, setForm] = useState({
    name: "", domain: "", industry: "", sizeBand: "",
    brandId: brandId ?? (brands[0]?.id ?? ""),
  });

  useEffect(() => {
    setForm((f) => ({ ...f, brandId: brandId ?? (brands[0]?.id ?? "") }));
  }, [brandId, brands]);

  const activeBrand = brands.find((b) => b.id === (brandId ?? form.brandId)) ?? null;

  const submit = async () => {
    if (!form.name.trim()) {
      toast({ title: "Name is required", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      await apiRequest("POST", "/api/marketing/companies", {
        name: form.name.trim(),
        domain: form.domain.trim() || null,
        industry: form.industry.trim() || null,
        sizeBand: form.sizeBand.trim() || null,
        brandId: form.brandId || null,
      });
      await queryClient.invalidateQueries({ queryKey: ["/api/marketing/companies"] });
      toast({ title: "Company created" });
      setForm({ name: "", domain: "", industry: "", sizeBand: "", brandId: form.brandId });
      setOpen(false);
    } catch (e: unknown) {
      toast({ title: "Failed to create company", description: e instanceof Error ? e.message : "", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button onClick={() => setOpen(true)} data-testid="button-add-company">
        <Plus className="w-4 h-4 mr-1.5" />Add Company
      </Button>
      <PremiumDialog
        open={open}
        onOpenChange={setOpen}
        icon={<BuildingIcon className="w-5 h-5" />}
        title="Add Company"
        subtitle="Companies are scoped to a brand. Domain is optional but recommended."
        className="max-w-2xl"
      >
        <div data-testid="dialog-add-company" className="grid grid-cols-2 gap-3">
          {brands.length > 1 && (
              <div className="col-span-2">
                <Label>Brand</Label>
                {brandId ? (
                  <div
                    className="flex items-center justify-between rounded-md px-3 py-2 text-sm"
                    style={{ background: "var(--lux-bg)", border: "1px solid var(--lux-border)" }}
                    data-testid="display-add-brand"
                  >
                    <span>{activeBrand?.name ?? "Active brand"}</span>
                    <span className="text-xs opacity-70">Locked to active brand</span>
                  </div>
                ) : (
                  <Select value={form.brandId} onValueChange={(v) => setForm({ ...form, brandId: v })}>
                    <SelectTrigger data-testid="select-add-brand"><SelectValue placeholder="Select a brand" /></SelectTrigger>
                    <SelectContent>
                      {brands.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
              </div>
            )}
            <div className="col-span-2">
              <Label htmlFor="add-co-name">Name *</Label>
              <Input id="add-co-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="input-add-name" />
            </div>
            <div className="col-span-2">
              <Label htmlFor="add-co-domain">Domain</Label>
              <Input id="add-co-domain" placeholder="example.com" value={form.domain} onChange={(e) => setForm({ ...form, domain: e.target.value })} data-testid="input-add-domain" />
            </div>
            <div>
              <Label htmlFor="add-co-industry">Industry</Label>
              <Input id="add-co-industry" value={form.industry} onChange={(e) => setForm({ ...form, industry: e.target.value })} data-testid="input-add-industry" />
            </div>
            <div>
              <Label htmlFor="add-co-size">Size</Label>
              <Input id="add-co-size" placeholder="1-10, 11-50…" value={form.sizeBand} onChange={(e) => setForm({ ...form, sizeBand: e.target.value })} data-testid="input-add-size" />
            </div>
        </div>
        <div className="flex justify-end gap-2 pt-2 border-t" style={{ borderColor: "var(--lux-border)" }}>
          <Button variant="outline" onClick={() => setOpen(false)} data-testid="button-cancel-add-company">Cancel</Button>
          <Button onClick={submit} disabled={busy} data-testid="button-submit-add-company">
            {busy ? "Creating…" : "Create Company"}
          </Button>
        </div>
      </PremiumDialog>
    </>
  );
}
