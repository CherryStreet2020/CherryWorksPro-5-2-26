import { SEO } from "@/components/seo";
import { SCREENS } from "@/components/marketing/screens";
import {
  ButtonLink, Closing, Container, Ctas, Display, Eyebrow, Fact, Heading, Lede, MarketingShell, Note, PageHero, Scene,
  Section, Shot, TextLink,
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
          <Eyebrow>Moving from Jira Service Management</Eyebrow>
          <Display testId="switch-jira-h1" className="mt-4">Jira runs a service desk. Your firm bills for service.</Display>
          <Lede size="hero" className="mt-6">
            If every support hour should end up on an invoice, a help desk that knows nothing about your clients’ contracts is the wrong shape. Bring the project across with its comments, attachments and keys, and run support where you already bill.
          </Lede>
          <Ctas>
            <ButtonLink href="/signup" testId="switch-jira-cta-signup">Start your trial</ButtonLink>
            <ButtonLink href="/client-support" variant="secondary" testId="switch-jira-cta-support">See the support desk</ButtonLink>
          </Ctas>
          <Note>Imports from Jira Cloud · Professional and up</Note>
          <Scene screen={SCREENS.supportCases} priority className="mt-14 md:mt-20" testId="switch-jira-hero-screen" />
          <div className="mt-14 grid gap-x-8 gap-y-10 sm:grid-cols-3 md:mt-20" data-testid="section-jira-facts">
            <Fact value="Original keys" label="kept on every case, and new cases carry on the numbering" />
            <Fact value="Closed issues" label="imported with their history, not just the open ones" />
            <Fact value="Run it again" label="later runs pick up new issues and skip the ones already here" />
          </div>
        </Container>
      </PageHero>

      <Section testId="section-pains">
        <Container>
          <div className="grid grid-cols-1 gap-12 lg:grid-cols-[5fr_7fr] lg:gap-[72px]">
            <Heading>Where Jira stops fitting a services firm.</Heading>
            <dl className="border-t border-[#E6E3DD] lg:mt-2">
              {PAINS.map((p, i) => (
                <div key={p.pain} data-testid={`pain-row-${i}`} className="grid gap-2 border-b border-[#E6E3DD] py-6 sm:grid-cols-[14rem_1fr] sm:gap-8">
                  <dt className="text-[17px] font-medium text-[#15171C]">{p.pain}</dt>
                  <dd className="text-[15.5px] leading-[1.55] text-[#5C606A]">{p.fix}</dd>
                </div>
              ))}
            </dl>
          </div>
        </Container>
      </Section>

      <Section testId="section-comparison">
        <Container>
          <Heading>What each one is built to do.</Heading>
          <div className="mt-10 md:mt-14">
            <table className="w-full table-fixed border-collapse text-left">
              <colgroup>
                <col />
                <col className="w-[34%] sm:w-[30%]" />
                <col className="w-[26%] sm:w-[24%]" />
              </colgroup>
              <thead>
                <tr className="border-b border-[#15171C] text-[14px] font-medium text-[#5C606A]">
                  <th scope="col" className="py-3 pr-2"><span className="sr-only">Capability</span></th>
                  <th scope="col" className="px-2 py-3 text-[#15171C] sm:px-4">CherryWorks Pro</th>
                  <th scope="col" className="px-2 py-3 sm:px-4">Jira SM</th>
                </tr>
              </thead>
              <tbody>
                {COMPARISON.map((c) => (
                  <tr key={c.row} className="border-b border-[#E6E3DD]">
                    <th scope="row" className="py-4 pr-2 align-top text-[14px] font-medium text-[#15171C] sm:text-[15.5px]">{c.row}</th>
                    <td className="px-2 py-4 align-top text-[13px] leading-snug text-[#15171C] sm:px-4 sm:text-[15.5px]">{c.cw}</td>
                    <td className="px-2 py-4 align-top text-[13px] leading-snug text-[#5C606A] sm:px-4 sm:text-[15.5px]">{c.jira}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-5 max-w-3xl text-[14px] leading-relaxed text-[#6E727B]">
            Jira Service Management as described on Atlassian’s site for its cloud plans, October 2026. Marketplace apps can add time tracking and invoicing to Jira.
          </p>
        </Container>
      </Section>

      <Section testId="section-import">
        <Container>
          <div className="grid grid-cols-1 gap-12 lg:grid-cols-[5fr_7fr] lg:gap-[72px]">
            <div>
              <Heading>Move a project while Jira stays on.</Heading>
              <ul className="mt-10 border-t border-[#E6E3DD]">
                {STEPS.map((s, i) => (
                  <li key={s.title} data-testid={`import-step-${i}`} className="border-b border-[#E6E3DD] py-6">
                    <h3 className="text-[17px] font-medium text-[#15171C]">{s.title}</h3>
                    <p className="mt-2 text-[15.5px] leading-[1.55] text-[#5C606A]">{s.body}</p>
                  </li>
                ))}
              </ul>
            </div>
            <div className="lg:pt-2">
              <Shot screen={SCREENS.caseDetail} />
              <div className="mt-10 grid gap-x-10 sm:grid-cols-2">
                <div className="border-t border-[#E6E3DD] pb-6 pt-5">
                  <h3 className="text-[17px] font-medium text-[#15171C]">Run it again before you switch off</h3>
                  <p className="mt-2 text-[15.5px] leading-[1.55] text-[#5C606A]">
                    Each run picks up new issues and skips the ones already imported. The last run can also copy attachments on closed issues.
                  </p>
                </div>
                <div className="border-t border-[#E6E3DD] pb-6 pt-5">
                  <h3 className="text-[17px] font-medium text-[#15171C]">What stays behind</h3>
                  <p className="mt-2 text-[15.5px] leading-[1.55] text-[#5C606A]">
                    Queues, automation rules and SLA settings don’t come across; you set SLA targets per client here. Jira Data Center and Server sites aren’t supported.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </Container>
      </Section>

      <Closing
        heading="Bring the project. Keep the history."
        body={<>The trial runs on Professional, Jira import included. Or read <TextLink href="/client-support" testId="link-switch-jira-support">how the support desk works</TextLink>.</>}
        primary={{ href: "/signup", label: "Start your trial", testId: "cta-start-trial" }}
        secondary={{ href: "/demo", label: "Book a demo", testId: "cta-book-demo" }}
      />
    </MarketingShell>
  );
}
