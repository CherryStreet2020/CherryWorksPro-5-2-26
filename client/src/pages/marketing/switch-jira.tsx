import { SEO } from "@/components/seo";
import {
  ButtonLink, Container, Display, Eyebrow, Fact, Heading, Lede, MarketingShell, PageHero, Screenshot, Section, TextLink,
} from "@/components/marketing/kit";

const PAINS = [
  {
    pain: "Priced per agent",
    fix: "Every plan here includes unlimited users, so whoever did the project work can pick up the case.",
  },
  {
    pain: "Support lives apart from billing",
    fix: "A case belongs to a client and a project, at that client’s rate. Hours logged on it are approved, invoiced and paid out with everything else.",
  },
  {
    pain: "Client accounts to manage",
    fix: "Approve a client’s business email domain and their people sign in to your Help Center with a one-time link. There are no passwords to reset.",
  },
  {
    pain: "Reports about tickets, not the firm",
    fix: "Case hours show up in utilization, project profitability and payout reports, next to the rest of the client’s work.",
  },
  {
    pain: "Built for IT departments",
    fix: "Connect the mailbox, approve the client’s domain, and the next email from that client is a case with an owner and an SLA clock.",
  },
];

const COMPARISON = [
  { row: "Pricing", cw: "Flat per firm, unlimited users", jira: "Per agent" },
  { row: "Email to case", cw: "From a Microsoft 365 mailbox", jira: "Yes" },
  { row: "SLA targets", cw: "Per client, in business hours", jira: "Yes" },
  { row: "Case hours on the client invoice", cw: "Built in", jira: "Not built in" },
  { row: "Paying the team for case hours", cw: "Built in", jira: "Not built in" },
  { row: "General ledger and AR", cw: "Built in", jira: "Not built in" },
  { row: "Automation rules and asset management", cw: "Not offered", jira: "Yes" },
];

const STEPS = [
  {
    title: "Connect Jira Cloud",
    body: "In Support settings, enter your Jira site, the project key, your Atlassian account email and an API token. The token is stored encrypted.",
  },
  {
    title: "Preview, then import",
    body: "A dry run shows what will come across before anything is written. The import brings each issue into the client you choose, with its comments, status history, attachments, original key and dates.",
  },
  {
    title: "Connect your support mailbox",
    body: "Connect the Microsoft 365 mailbox behind your support address. From then on, email from your clients’ contacts opens cases here.",
  },
  {
    title: "Approve your clients’ domains",
    body: "Approve each client’s business email domain so their people can sign in to the Help Center with a one-time link.",
  },
];

export default function SwitchJiraPage() {
  return (
    <MarketingShell>
      <SEO path="/switch-from-jira-service-management" />

      <PageHero>
        <Container>
          <div className="max-w-3xl">
            <Eyebrow>Switch from Jira Service Management</Eyebrow>
            <Display testId="switch-jira-h1" className="mt-5">Jira runs a service desk. Your firm bills for service.</Display>
            <Lede className="mt-6 max-w-2xl">
              If every support hour should end up on an invoice, a help desk that knows nothing about your clients’
              contracts is the wrong shape. Bring the project across with its comments, attachments and keys, and run
              support where you already bill.
            </Lede>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
              <ButtonLink href="/signup" size="lg" arrow testId="switch-jira-cta-signup">Start your 14-day trial</ButtonLink>
              <ButtonLink href="/client-support" size="lg" variant="secondary" testId="switch-jira-cta-support">See Client Support</ButtonLink>
            </div>
            <p className="mt-5 text-sm text-[#5F6672]">
              Imports from Jira Cloud · <span className="whitespace-nowrap">On the Professional and Business plans</span>
            </p>
          </div>
          <div className="mt-14 grid grid-cols-1 gap-x-8 gap-y-8 border-t border-[#E6E2DA] pt-10 sm:grid-cols-3" data-testid="section-jira-facts">
            <Fact value="Original keys" label="kept on every case, and new cases carry on the numbering" />
            <Fact value="Closed issues" label="imported with their history, not just the open ones" />
            <Fact value="Run it again" label="later runs pick up new issues and skip the ones already here" />
          </div>
        </Container>
      </PageHero>

      <Section tone="white" testId="section-pains">
        <Container>
          <div className="grid gap-12 lg:grid-cols-12 lg:gap-16">
            <div className="lg:col-span-4">
              <Eyebrow>Why firms move</Eyebrow>
              <Heading className="mt-4">Where Jira stops fitting a services firm</Heading>
            </div>
            <dl className="divide-y divide-[#E6E2DA] border-y border-[#E6E2DA] lg:col-span-8">
              {PAINS.map((p, i) => (
                <div key={p.pain} data-testid={`pain-row-${i}`} className="grid gap-2 py-6 sm:grid-cols-[14rem_1fr] sm:gap-8">
                  <dt className="font-semibold text-[#15171C]">{p.pain}</dt>
                  <dd className="text-[15px] leading-relaxed text-[#3D4350]">{p.fix}</dd>
                </div>
              ))}
            </dl>
          </div>
        </Container>
      </Section>

      <Section testId="section-comparison">
        <Container>
          <div className="max-w-2xl">
            <Eyebrow>Side by side</Eyebrow>
            <Heading className="mt-4">What each one is built to do</Heading>
          </div>
          <div className="mt-12 overflow-hidden rounded-xl border border-[#E6E2DA] bg-white">
            <table className="w-full table-fixed border-collapse text-left">
              <colgroup>
                <col />
                <col className="w-[34%] sm:w-[30%]" />
                <col className="w-[26%] sm:w-[24%]" />
              </colgroup>
              <thead>
                <tr className="border-b border-[#E6E2DA] bg-[#FBFAF7] text-[12px] font-semibold uppercase tracking-[0.08em] text-[#5F6672]">
                  <th scope="col" className="py-3.5 pl-4 pr-2 sm:px-6"><span className="sr-only">Capability</span></th>
                  <th scope="col" className="px-2 py-3.5 text-[#15171C] sm:px-6">CherryWorks Pro</th>
                  <th scope="col" className="px-2 py-3.5 sm:px-6">Jira SM</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E6E2DA]">
                {COMPARISON.map((c) => (
                  <tr key={c.row}>
                    <th scope="row" className="py-4 pl-4 pr-2 align-top text-[14px] font-medium text-[#15171C] sm:px-6 sm:text-[15px]">{c.row}</th>
                    <td className="px-2 py-4 align-top text-[13px] leading-snug text-[#15171C] sm:px-6 sm:text-[15px]">{c.cw}</td>
                    <td className="px-2 py-4 align-top text-[13px] leading-snug text-[#5F6672] sm:px-6 sm:text-[15px]">{c.jira}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-4 max-w-3xl text-sm leading-relaxed text-[#5F6672]">
            Jira Service Management as described on Atlassian’s site for its cloud plans, October 2026. Marketplace apps can
            add time tracking and invoicing to Jira.
          </p>
        </Container>
      </Section>

      <Section tone="white" testId="section-import">
        <Container>
          <div className="grid gap-12 lg:grid-cols-12 lg:gap-16">
            <div className="lg:col-span-5">
              <Eyebrow>Moving a project</Eyebrow>
              <Heading className="mt-4">Four steps, and Jira stays on until you’re ready</Heading>
              <ol className="mt-10">
                {STEPS.map((s, i) => (
                  <li
                    key={s.title}
                    data-testid={`import-step-${i}`}
                    className="grid grid-cols-[2.25rem_1fr] gap-3 border-t border-[#E6E2DA] py-6 first:border-t-0 first:pt-0"
                  >
                    <span className="font-display text-lg font-semibold text-[#B32A30]">{i + 1}</span>
                    <div>
                      <h3 className="text-lg font-semibold text-[#15171C]">{s.title}</h3>
                      <p className="mt-1.5 text-[15px] leading-relaxed text-[#3D4350]">{s.body}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
            <div className="space-y-10 lg:col-span-7 lg:pt-2">
              <Screenshot
                src="/marketing/screens/case-detail.webp"
                width={2000}
                height={1521}
                url="cherryworkspro.com/support/cases/BL-1"
                alt="One support case: the client's report, a reply and an internal note, and the hours logged on the case with how many are billable, unbilled and invoiced."
              />
              <div className="grid gap-8 sm:grid-cols-2">
                <div className="border-t border-[#15171C] pt-5">
                  <h3 className="font-semibold text-[#15171C]">Run it again before you switch off</h3>
                  <p className="mt-2 text-[15px] leading-relaxed text-[#3D4350]">
                    Each run picks up new issues and skips the ones already imported. The last run can also copy
                    attachments on closed issues.
                  </p>
                </div>
                <div className="border-t border-[#15171C] pt-5">
                  <h3 className="font-semibold text-[#15171C]">What stays behind</h3>
                  <p className="mt-2 text-[15px] leading-relaxed text-[#3D4350]">
                    Queues, automation rules and SLA settings don’t come across; you set SLA targets per client here.
                    Jira Data Center and Server sites aren’t supported.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </Container>
      </Section>

      <Section tone="night" testId="section-cta">
        <Container>
          <div className="max-w-3xl">
            <h2 className="font-display text-3xl font-semibold leading-[1.12] tracking-[-0.015em] text-white text-balance md:text-5xl">
              Bring the project. Keep the history.
            </h2>
            <p className="mt-5 text-lg text-white/70">
              14-day trial on the Professional plan, Jira import included. You won’t be charged until day 15 · Cancel anytime.
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <ButtonLink href="/signup" size="lg" arrow testId="cta-start-trial">Start free trial</ButtonLink>
              <ButtonLink href="/demo" size="lg" variant="onNight" testId="cta-book-demo">Book a demo</ButtonLink>
            </div>
            <TextLink href="/client-support" testId="link-switch-jira-support" className="mt-7 !text-white decoration-white/40 hover:decoration-white">
              How Client Support works
            </TextLink>
          </div>
        </Container>
      </Section>
    </MarketingShell>
  );
}
