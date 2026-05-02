/**
 * Sprint 2m — Premium primitives showcase (DEV-ONLY).
 *
 * Renders all 11 premium primitives grouped into Dialogs / Forms /
 * Cards / Data / Tabs sections with realistic sample data. Reachable
 * only at `/__premium-showcase` and only in `import.meta.env.DEV`
 * builds (gated in `client/src/App.tsx`).
 */
import * as React from "react";
import { Moon, Sun, Sparkles, Mail, Building2, BarChart3 } from "lucide-react";
import { useTheme } from "@/lib/theme";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SectionCard } from "@/components/marketing-os/premium/section-card";
import { LogoDropzone } from "@/components/marketing-os/premium/logo-dropzone";
import { ColorSwatchPicker } from "@/components/marketing-os/premium/color-swatch-picker";
import { InlineEditableField } from "@/components/marketing-os/premium/inline-editable-field";
import { MetricCard } from "@/components/marketing-os/premium/metric-card";
import { EmailPreview } from "@/components/marketing-os/premium/email-preview";
import {
  StatusRibbon,
  type LifecycleStage,
} from "@/components/marketing-os/premium/status-ribbon";
import { AvatarStack } from "@/components/marketing-os/premium/avatar-stack";
import { FreshnessDot } from "@/components/marketing-os/premium/freshness-dot";
import { PillTab } from "@/components/marketing-os/premium/pill-tab";
import { PremiumDialog } from "@/components/marketing-os/premium/premium-dialog";

const STAGES: LifecycleStage[] = [
  "lead",
  "mql",
  "sql",
  "opportunity",
  "customer",
  "evangelist",
];

const PEOPLE = [
  { name: "Mira Patel" },
  { name: "Jordan Wei" },
  { name: "Sasha Reyes" },
  { name: "Theo Nakamura" },
  { name: "Ava Lindgren" },
  { name: "Otto Costa" },
];

export default function PremiumShowcasePage() {
  const { theme, toggle } = useTheme();
  const [color, setColor] = React.useState("#cf3339");
  const [logo, setLogo] = React.useState<string | null>(null);
  const [name, setName] = React.useState("Acme Holdings");
  const [tab, setTab] = React.useState("overview");
  const [dialogOpen, setDialogOpen] = React.useState(false);

  return (
    <div
      className="min-h-screen p-6"
      style={{ background: "var(--lux-bg)", color: "var(--lux-text)" }}
      data-testid="premium-showcase-page"
    >
      <div className="mx-auto max-w-6xl space-y-8">
        {/* Top bar */}
        <div className="flex items-center justify-between">
          <div>
            <h1
              className="text-2xl font-semibold"
              style={{ color: "var(--lux-text)" }}
            >
              Marketing OS — Premium Primitives
            </h1>
            <p className="mt-1 text-sm" style={{ color: "var(--lux-text-muted)" }}>
              Sprint 2m visual foundation. Dev-only showcase.
            </p>
          </div>
          <button
            onClick={toggle}
            className="flex h-9 w-9 items-center justify-center rounded-full border transition-colors"
            style={{
              background: "var(--lux-surface)",
              borderColor: "var(--lux-border)",
              color: "var(--lux-text)",
            }}
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            data-testid="button-theme-toggle"
          >
            {theme === "dark" ? (
              <Sun className="h-4 w-4" />
            ) : (
              <Moon className="h-4 w-4" />
            )}
          </button>
        </div>

        {/* Screenshot checklist banner */}
        <div
          className="rounded-xl border p-4 text-sm"
          style={{
            background: "var(--lux-surface-alt)",
            borderColor: "var(--lux-border)",
            color: "var(--lux-text-secondary)",
          }}
          data-testid="screenshot-checklist-banner"
        >
          <strong style={{ color: "var(--lux-text)" }}>
            Screenshot checklist:
          </strong>{" "}
          dialogs · forms · cards · data · tabs — capture each section in
          BOTH light and dark modes (toggle top-right) for the proof
          bundle.
        </div>

        {/* Dialogs */}
        <Section title="Dialogs" id="section-dialogs">
          <div className="flex items-center gap-3">
            <Button onClick={() => setDialogOpen(true)} data-testid="button-open-premium-dialog">
              Open premium dialog
            </Button>
            <span className="text-xs" style={{ color: "var(--lux-text-muted)" }}>
              Two-column dialog with live email preview.
            </span>
          </div>
          <PremiumDialog
            open={dialogOpen}
            onOpenChange={setDialogOpen}
            icon={<Mail className="h-5 w-5" />}
            title="Compose campaign email"
            subtitle="Draft · Acme Q2 nurture"
            preview={<EmailPreview subject="Quick check-in 👋" />}
          >
            <div className="space-y-2">
              <Label>Subject line</Label>
              <Input defaultValue="Quick check-in 👋" />
            </div>
            <div className="space-y-2">
              <Label>Body</Label>
              <textarea
                defaultValue="Hi there, just following up on our last conversation."
                className="min-h-[120px] w-full rounded-md border bg-transparent p-2 text-sm"
                style={{
                  borderColor: "var(--lux-border)",
                  color: "var(--lux-text)",
                }}
              />
            </div>
          </PremiumDialog>
        </Section>

        {/* Forms */}
        <Section title="Forms" id="section-forms">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <SectionCard
              icon={<Building2 className="h-4 w-4" />}
              title="Brand identity"
              subtitle="Logo and primary color used across emails."
            >
              <LogoDropzone value={logo} onChange={setLogo} />
              <ColorSwatchPicker value={color} onChange={setColor} />
            </SectionCard>
            <SectionCard
              icon={<Sparkles className="h-4 w-4" />}
              title="Account profile"
              subtitle="Click any field to edit inline."
            >
              <div className="flex items-center gap-2">
                <Label className="w-24 text-xs">Name</Label>
                <InlineEditableField value={name} onChange={setName} />
              </div>
              <div className="flex items-center gap-2">
                <Label className="w-24 text-xs">Industry</Label>
                <InlineEditableField
                  value=""
                  onChange={() => {}}
                  placeholder="Add industry"
                />
              </div>
            </SectionCard>
          </div>
        </Section>

        {/* Cards */}
        <Section title="Cards" id="section-cards">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <MetricCard
              label="MRR"
              value="$48,210"
              delta={12}
              deltaLabel="MoM"
              icon={<BarChart3 className="h-4 w-4" />}
            />
            <MetricCard label="Open rate" value="42.6%" delta={-3} deltaLabel="WoW" />
            <MetricCard label="Active contacts" value="1,284" delta={0} />
          </div>
          <div className="mt-4">
            <EmailPreview />
          </div>
        </Section>

        {/* Data */}
        <Section title="Data" id="section-data">
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {STAGES.map((s) => (
                <StatusRibbon key={s} stage={s} />
              ))}
            </div>
            <div className="flex items-center gap-6">
              <AvatarStack people={PEOPLE} />
              <div className="flex items-center gap-4">
                <FreshnessDot
                  lastActivityAt={new Date()}
                  showLabel
                />
                <FreshnessDot
                  lastActivityAt={new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)}
                  showLabel
                />
                <FreshnessDot
                  lastActivityAt={new Date(Date.now() - 60 * 24 * 60 * 60 * 1000)}
                  showLabel
                />
                <FreshnessDot lastActivityAt={null} showLabel />
              </div>
            </div>
          </div>
        </Section>

        {/* Tabs */}
        <Section title="Tabs" id="section-tabs">
          <PillTab
            value={tab}
            onValueChange={setTab}
            items={[
              { value: "overview", label: "Overview" },
              { value: "campaigns", label: "Campaigns" },
              { value: "audience", label: "Audience" },
              { value: "settings", label: "Settings" },
            ]}
          />
        </Section>
      </div>
    </div>
  );
}

function Section({
  title,
  id,
  children,
}: {
  title: string;
  id: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} data-testid={id}>
      <h2
        className="mb-3 text-xs font-semibold uppercase tracking-wider"
        style={{ color: "var(--lux-text-muted)" }}
      >
        {title}
      </h2>
      <div
        className="rounded-xl border p-5"
        style={{
          background: "var(--lux-surface)",
          borderColor: "var(--lux-border)",
          boxShadow: "var(--lux-card-shadow)",
        }}
      >
        {children}
      </div>
    </section>
  );
}
