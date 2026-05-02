import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { format } from "date-fns";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { FilePlus } from "lucide-react";
import type { Client, Project } from "@shared/schema";

const blankInvoiceSchema = z.object({
  clientId: z.string().min(1, "Client is required"),
  projectId: z.string().optional(),
  issuedDate: z.string().min(1, "Issue date is required"),
  dueDate: z.string().min(1, "Due date is required"),
  currency: z.string().min(1, "Currency is required"),
  notes: z.string().optional(),
});

type BlankInvoiceForm = z.infer<typeof blankInvoiceSchema>;

interface BlankInvoiceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (invoice: any) => void;
  defaultCurrency?: string;
}

export function BlankInvoiceDialog({ open, onOpenChange, onCreated, defaultCurrency = "USD" }: BlankInvoiceDialogProps) {
  const { toast } = useToast();
  const today = format(new Date(), "yyyy-MM-dd");
  const defaultDue = format(new Date(Date.now() + 30 * 86400000), "yyyy-MM-dd");

  const { data: clients } = useQuery<Client[]>({
    queryKey: ["/api/clients"],
  });

  const { data: projects } = useQuery<Project[]>({
    queryKey: ["/api/projects"],
  });

  const form = useForm<BlankInvoiceForm>({
    resolver: zodResolver(blankInvoiceSchema),
    defaultValues: {
      clientId: "",
      projectId: "",
      issuedDate: today,
      dueDate: defaultDue,
      currency: defaultCurrency,
      notes: "",
    },
  });

  const selectedClientId = form.watch("clientId");

  const filteredProjects = useMemo(() => {
    if (!projects || !selectedClientId) return [];
    return projects.filter((p) => p.clientId === selectedClientId);
  }, [projects, selectedClientId]);

  const createMutation = useMutation({
    mutationFn: async (data: BlankInvoiceForm) => {
      const res = await apiRequest("POST", "/api/invoices", {
        clientId: data.clientId,
        projectId: data.projectId && data.projectId !== "__none__" ? data.projectId : undefined,
        issuedDate: data.issuedDate,
        dueDate: data.dueDate,
        currency: data.currency,
        notes: data.notes || null,
        lines: [],
        status: "DRAFT",
      });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      toast({ title: "Invoice Created", description: `Draft invoice ${data.number} created.` });
      form.reset({
        clientId: "",
        projectId: "",
        issuedDate: today,
        dueDate: defaultDue,
        currency: defaultCurrency,
        notes: "",
      });
      onOpenChange(false);
      onCreated(data);
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message || "Failed to create invoice", variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" style={{ background: "var(--lux-surface)" }}>
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "linear-gradient(135deg, rgba(var(--lux-accent-rgb),0.18) 0%, rgba(168,85,247,0.12) 100%)" }}>
              <FilePlus className="w-5 h-5" style={{ color: "var(--lux-accent)" }} />
            </div>
            <div>
              <DialogTitle className="text-lg font-bold" style={{ color: "var(--lux-text)" }}>Create Blank Invoice</DialogTitle>
              <p className="text-xs mt-0.5" style={{ color: "var(--lux-text-muted)" }}>Create a draft invoice and add line items manually</p>
            </div>
          </div>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((data) => createMutation.mutate(data))} className="space-y-4 mt-2">
            <FormField
              control={form.control}
              name="clientId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel style={{ color: "var(--lux-text)" }}>Client *</FormLabel>
                  <Select onValueChange={(v) => { field.onChange(v); form.setValue("projectId", ""); }} value={field.value}>
                    <FormControl>
                      <SelectTrigger style={{ background: "var(--lux-bg)", borderColor: "var(--lux-border)", color: "var(--lux-text)" }} data-testid="select-blank-client">
                        <SelectValue placeholder="Select a client" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {clients?.map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="projectId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel style={{ color: "var(--lux-text)" }}>Project (optional)</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value || ""}>
                    <FormControl>
                      <SelectTrigger style={{ background: "var(--lux-bg)", borderColor: "var(--lux-border)", color: "var(--lux-text)" }} data-testid="select-blank-project">
                        <SelectValue placeholder="No project" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="__none__">None</SelectItem>
                      {filteredProjects.map((p) => (
                        <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="issuedDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel style={{ color: "var(--lux-text)" }}>Issue Date</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} style={{ background: "var(--lux-bg)", borderColor: "var(--lux-border)", color: "var(--lux-text)" }} data-testid="input-blank-issue-date" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="dueDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel style={{ color: "var(--lux-text)" }}>Due Date</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} style={{ background: "var(--lux-bg)", borderColor: "var(--lux-border)", color: "var(--lux-text)" }} data-testid="input-blank-due-date" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="currency"
              render={({ field }) => (
                <FormItem>
                  <FormLabel style={{ color: "var(--lux-text)" }}>Currency</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger style={{ background: "var(--lux-bg)", borderColor: "var(--lux-border)", color: "var(--lux-text)" }} data-testid="select-blank-currency">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="USD">USD</SelectItem>
                      <SelectItem value="EUR">EUR</SelectItem>
                      <SelectItem value="GBP">GBP</SelectItem>
                      <SelectItem value="CAD">CAD</SelectItem>
                      <SelectItem value="AUD">AUD</SelectItem>
                      <SelectItem value="JPY">JPY</SelectItem>
                      <SelectItem value="CHF">CHF</SelectItem>
                      <SelectItem value="CNY">CNY</SelectItem>
                      <SelectItem value="INR">INR</SelectItem>
                      <SelectItem value="MXN">MXN</SelectItem>
                      <SelectItem value="BRL">BRL</SelectItem>
                      <SelectItem value="SGD">SGD</SelectItem>
                      <SelectItem value="HKD">HKD</SelectItem>
                      <SelectItem value="NZD">NZD</SelectItem>
                      <SelectItem value="SEK">SEK</SelectItem>
                      <SelectItem value="NOK">NOK</SelectItem>
                      <SelectItem value="DKK">DKK</SelectItem>
                      <SelectItem value="ZAR">ZAR</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel style={{ color: "var(--lux-text)" }}>Notes</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      placeholder="Optional notes for this invoice..."
                      className="min-h-[60px]"
                      style={{ background: "var(--lux-bg)", borderColor: "var(--lux-border)", color: "var(--lux-text)" }}
                      data-testid="input-blank-notes"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} data-testid="button-blank-cancel">Cancel</Button>
              <Button
                type="submit"
                disabled={createMutation.isPending}
                className="text-white"
                style={{ background: "var(--gradient-brand)" }}
                data-testid="button-blank-submit"
              >
                {createMutation.isPending ? "Creating..." : "Create Draft Invoice"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
