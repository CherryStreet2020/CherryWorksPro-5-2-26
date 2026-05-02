/**
 * Marketing OS — Sprint 2b: Company detail (/marketing/companies/:id).
 *
 * Shows company fields (editable inline via dialog), linked contacts list,
 * and the activity timeline.
 */
import { useState } from "react";
import { Link, useRoute, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ArrowLeft, Building2, Globe, Trash2, Pencil, Users, Activity } from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { isMarketingOsEnabled } from "@/lib/featureFlags";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { PremiumDialog } from "@/components/marketing-os/premium/premium-dialog";
import { MetricCard } from "@/components/marketing-os/premium/metric-card";
import { AvatarStack } from "@/components/marketing-os/premium/avatar-stack";
import {
  StatusRibbon,
  type LifecycleStage,
} from "@/components/marketing-os/premium/status-ribbon";
import type { Company, ClientContact, ContactActivity } from "@shared/schema";

const RIBBON_STAGES = new Set<LifecycleStage>([
  "lead", "mql", "sql", "opportunity", "customer", "evangelist",
]);

type CompanyActivity = ContactActivity & { contactName?: string | null; firstName?: string | null; lastName?: string | null };

type CompanyWithCount = Company & { contactsCount: number };

const editSchema = z.object({
  name: z.string().min(1, "Name is required"),
  domain: z.string().optional().nullable(),
  industry: z.string().optional().nullable(),
  sizeBand: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  linkedinUrl: z.string().url().optional().or(z.literal("")).nullable(),
});
type EditValues = z.infer<typeof editSchema>;

export default function CompanyDetailPage() {
  const flagOn = isMarketingOsEnabled();
  const [, params] = useRoute<{ id: string }>("/marketing/companies/:id");
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const id = params?.id;

  const [editOpen, setEditOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const { data: company, isLoading } = useQuery<CompanyWithCount>({
    queryKey: ["/api/marketing/companies", id],
    enabled: flagOn && !!id,
    queryFn: async () => {
      const res = await fetch(`/api/marketing/companies/${id}`, { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
  });

  const { data: contacts = [] } = useQuery<ClientContact[]>({
    queryKey: ["/api/marketing/companies", id, "contacts"],
    enabled: flagOn && !!id,
    queryFn: async () => {
      const res = await fetch(`/api/marketing/companies/${id}/contacts`, { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      return json.rows as ClientContact[];
    },
  });

  const { data: activities = [] } = useQuery<CompanyActivity[]>({
    queryKey: ["/api/marketing/companies", id, "activities"],
    enabled: flagOn && !!id,
    queryFn: async () => {
      const res = await fetch(`/api/marketing/companies/${id}/activities`, { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      return json.rows as CompanyActivity[];
    },
  });

  const onDelete = async () => {
    try {
      await apiRequest("DELETE", `/api/marketing/companies/${id}`);
      await queryClient.invalidateQueries({ queryKey: ["/api/marketing/companies"] });
      toast({ title: "Company deleted" });
      setLocation("/marketing/companies");
    } catch (e: unknown) {
      toast({ title: "Delete failed", description: e instanceof Error ? e.message : "", variant: "destructive" });
    }
  };

  if (!flagOn) {
    return <div className="p-10 text-center text-sm" style={{ color: "var(--lux-text-muted)" }} data-testid="status-flag-off">Marketing is available on the Business plan. Upgrade anytime from Settings → Plan.</div>;
  }
  if (isLoading) {
    return <div className="p-10 text-sm" data-testid="status-loading">Loading…</div>;
  }
  if (!company) {
    return (
      <div className="p-10 text-center text-sm" data-testid="status-not-found">
        Company not found.{" "}
        <Link href="/marketing/companies" className="underline">Back to companies</Link>
      </div>
    );
  }

  return (
    <div className="px-6 lg:px-8 xl:px-10 py-6 max-w-5xl mx-auto">
      <div className="mb-4">
        <Link href="/marketing/companies" className="inline-flex items-center text-sm" style={{ color: "var(--lux-text-muted)" }} data-testid="link-back">
          <ArrowLeft className="w-4 h-4 mr-1" />Back to companies
        </Link>
      </div>

      <Card className="border-0 mb-4" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }}>
        <CardContent className="p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2" style={{ color: "var(--lux-text)" }} data-testid="text-company-name">
                <Building2 className="w-6 h-6" />{company.name}
                {company.deletedAt && (
                  <span className="text-[10px] uppercase px-1.5 py-0.5 rounded" style={{ background: "var(--lux-border)", color: "var(--lux-text-muted)" }} data-testid="badge-deleted">
                    Deleted
                  </span>
                )}
              </h1>
              <div className="mt-2 flex flex-wrap items-center gap-4 text-sm" style={{ color: "var(--lux-text-muted)" }}>
                {company.domain && (
                  <span data-testid="text-domain">
                    <Globe className="inline w-3 h-3 mr-1" />{company.domain}
                  </span>
                )}
                {company.industry && <span data-testid="text-industry">{company.industry}</span>}
                {company.sizeBand && <span data-testid="text-size">{company.sizeBand}</span>}
                <span data-testid="text-source">Source: {company.source ?? "manual"}</span>
                <span data-testid="text-contacts-count">{company.contactsCount} contact{company.contactsCount === 1 ? "" : "s"}</span>
              </div>
              {contacts.length > 0 && (
                <div className="mt-3" data-testid="avatar-stack-contacts">
                  <AvatarStack
                    people={contacts.map((c) => ({
                      name: `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim() || c.email || "Contact",
                    }))}
                    max={6}
                  />
                </div>
              )}
              {company.notes && (
                <p className="mt-3 text-sm whitespace-pre-wrap" style={{ color: "var(--lux-text)" }} data-testid="text-notes">{company.notes}</p>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setEditOpen(true)} data-testid="button-edit">
                <Pencil className="w-3.5 h-3.5 mr-1" />Edit
              </Button>
              {!company.deletedAt && (
                <Button variant="outline" size="sm" onClick={() => setConfirmDelete(true)} data-testid="button-delete">
                  <Trash2 className="w-3.5 h-3.5 mr-1" />Delete
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Sprint 2m: at-a-glance metrics for the company surface. */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4" data-testid="row-company-metrics">
        <MetricCard label="Linked contacts" value={company.contactsCount} />
        <MetricCard label="Activities" value={activities.length} />
        <MetricCard label="Source" value={company.source ?? "manual"} />
      </div>

      {/* Linked contacts */}
      <Card className="border-0 mb-4" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }}>
        <CardContent className="p-4">
          <h2 className="font-semibold mb-3 flex items-center gap-2" style={{ color: "var(--lux-text)" }}>
            <Users className="w-4 h-4" />Linked Contacts ({contacts.length})
          </h2>
          {contacts.length === 0 ? (
            <p className="text-sm py-4" style={{ color: "var(--lux-text-muted)" }} data-testid="empty-state-contacts">
              No contacts linked to this company yet.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead style={{ borderBottom: "1px solid var(--lux-border)" }}>
                <tr>
                  <th className="px-2 py-2 text-left font-medium" style={{ color: "var(--lux-text-muted)" }}>Name</th>
                  <th className="px-2 py-2 text-left font-medium" style={{ color: "var(--lux-text-muted)" }}>Email</th>
                  <th className="px-2 py-2 text-left font-medium" style={{ color: "var(--lux-text-muted)" }}>Title</th>
                  <th className="px-2 py-2 text-left font-medium" style={{ color: "var(--lux-text-muted)" }}>Stage</th>
                </tr>
              </thead>
              <tbody>
                {contacts.map((c) => (
                  <tr key={c.id} style={{ borderBottom: "1px solid var(--lux-border)" }} data-testid={`row-contact-${c.id}`}>
                    <td className="px-2 py-2">
                      <Link href={`/marketing/contacts/${c.id}`} className="hover:underline" style={{ color: "var(--lux-text)" }} data-testid={`link-contact-${c.id}`}>
                        {`${c.firstName ?? ""} ${c.lastName ?? ""}`.trim() || "(unnamed)"}
                      </Link>
                    </td>
                    <td className="px-2 py-2" style={{ color: "var(--lux-text-muted)" }}>{c.email || "—"}</td>
                    <td className="px-2 py-2" style={{ color: "var(--lux-text-muted)" }}>{c.title || "—"}</td>
                    <td className="px-2 py-2">
                      {c.lifecycleStage && RIBBON_STAGES.has(c.lifecycleStage as LifecycleStage) ? (
                        <StatusRibbon stage={c.lifecycleStage as LifecycleStage} />
                      ) : (
                        <span style={{ color: "var(--lux-text-muted)" }}>{c.lifecycleStage || "—"}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* Activity timeline */}
      <Card className="border-0" style={{ background: "var(--lux-surface)", boxShadow: "var(--lux-card-shadow)" }}>
        <CardContent className="p-4">
          <h2 className="font-semibold mb-3 flex items-center gap-2" style={{ color: "var(--lux-text)" }}>
            <Activity className="w-4 h-4" />Activity ({activities.length})
          </h2>
          {activities.length === 0 ? (
            <p className="text-sm py-4" style={{ color: "var(--lux-text-muted)" }} data-testid="empty-state-activities">
              No activity yet.
            </p>
          ) : (
            <ul className="space-y-2">
              {activities.map((a) => (
                <li key={a.id} className="text-sm flex items-start gap-3 py-2" style={{ borderBottom: "1px solid var(--lux-border)" }} data-testid={`activity-${a.id}`}>
                  <span className="text-xs px-2 py-0.5 rounded" style={{ background: "var(--lux-bg)", border: "1px solid var(--lux-border)", color: "var(--lux-text-muted)" }}>
                    {a.type}
                  </span>
                  <div className="flex-1">
                    {!!a.payload && typeof a.payload === "object" ? (
                      <pre className="text-xs whitespace-pre-wrap" style={{ color: "var(--lux-text-muted)" }}>
                        {JSON.stringify(a.payload as any, null, 2)}
                      </pre>
                    ) : null}
                  </div>
                  <span className="text-xs whitespace-nowrap" style={{ color: "var(--lux-text-muted)" }}>
                    {a.createdAt ? new Date(a.createdAt).toLocaleString() : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <EditCompanyDialog open={editOpen} onOpenChange={setEditOpen} company={company} />

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent data-testid="dialog-confirm-delete">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this company?</AlertDialogTitle>
            <AlertDialogDescription>
              The company will be soft-deleted. Linked contacts will have their company link cleared (ON DELETE SET NULL).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={onDelete} data-testid="button-confirm-delete">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function EditCompanyDialog({
  open, onOpenChange, company,
}: { open: boolean; onOpenChange: (o: boolean) => void; company: Company }) {
  const { toast } = useToast();
  const form = useForm<EditValues>({
    resolver: zodResolver(editSchema),
    defaultValues: {
      name: company.name,
      domain: company.domain ?? "",
      industry: company.industry ?? "",
      sizeBand: company.sizeBand ?? "",
      notes: company.notes ?? "",
      linkedinUrl: company.linkedinUrl ?? "",
    },
  });

  const onSubmit = async (values: EditValues) => {
    try {
      await apiRequest("PATCH", `/api/marketing/companies/${company.id}`, {
        name: values.name,
        domain: values.domain || null,
        industry: values.industry || null,
        sizeBand: values.sizeBand || null,
        notes: values.notes || null,
        linkedinUrl: values.linkedinUrl || null,
      });
      await queryClient.invalidateQueries({ queryKey: ["/api/marketing/companies"] });
      toast({ title: "Company updated" });
      onOpenChange(false);
    } catch (e: unknown) {
      toast({ title: "Update failed", description: e instanceof Error ? e.message : "", variant: "destructive" });
    }
  };

  return (
    <PremiumDialog
      open={open}
      onOpenChange={onOpenChange}
      icon={<Building2 className="w-5 h-5" />}
      title="Edit Company"
      subtitle="Update company details. Domain and LinkedIn URL are optional."
      className="max-w-2xl"
    >
      <div data-testid="dialog-edit-company">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
            <FormField name="name" control={form.control} render={({ field }) => (
              <FormItem>
                <FormLabel>Name *</FormLabel>
                <FormControl><Input {...field} data-testid="input-edit-name" /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField name="domain" control={form.control} render={({ field }) => (
              <FormItem>
                <FormLabel>Domain</FormLabel>
                <FormControl><Input {...field} value={field.value ?? ""} placeholder="example.com" data-testid="input-edit-domain" /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <div className="grid grid-cols-2 gap-3">
              <FormField name="industry" control={form.control} render={({ field }) => (
                <FormItem>
                  <FormLabel>Industry</FormLabel>
                  <FormControl><Input {...field} value={field.value ?? ""} data-testid="input-edit-industry" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField name="sizeBand" control={form.control} render={({ field }) => (
                <FormItem>
                  <FormLabel>Size</FormLabel>
                  <FormControl><Input {...field} value={field.value ?? ""} data-testid="input-edit-size" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
            <FormField name="linkedinUrl" control={form.control} render={({ field }) => (
              <FormItem>
                <FormLabel>LinkedIn URL</FormLabel>
                <FormControl><Input {...field} value={field.value ?? ""} placeholder="https://linkedin.com/company/…" data-testid="input-edit-linkedin" /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField name="notes" control={form.control} render={({ field }) => (
              <FormItem>
                <FormLabel>Notes</FormLabel>
                <FormControl><Textarea rows={3} {...field} value={field.value ?? ""} data-testid="input-edit-notes" /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <div className="flex justify-end gap-2 pt-3 border-t" style={{ borderColor: "var(--lux-border)" }}>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel-edit">Cancel</Button>
              <Button type="submit" disabled={form.formState.isSubmitting} data-testid="button-submit-edit">
                {form.formState.isSubmitting ? "Saving…" : "Save"}
              </Button>
            </div>
          </form>
        </Form>
      </div>
    </PremiumDialog>
  );
}
