import type { ReactNode } from "react";
import { Link } from "wouter";
import { MarketingNav } from "@/components/marketing/marketing-nav";
import { MarketingFooter } from "@/components/marketing/marketing-footer";
import type { ScreenSpec } from "@/components/marketing/screens";

/**
 * The public site's design kit. One quiet look for every marketing page: warm
 * paper, ink type in Switzer, real product screens on a dark stage or a soft
 * tint, and cherry kept for small labels. Sections are separated by space and
 * hairlines, never by colored bands. Pages compose these pieces instead of
 * hand-rolling colors, so the site reads as one product.
 *
 * Content is visible by default: nothing here hides a section until a scroll
 * observer fires, so pre-rendered HTML and slow devices never show blank bands.
 */

export const MK = {
  paper: "#FBFAF8",
  ink: "#15171C",
  muted: "#5C606A",
  /** Small print. #8A8E97 is too light for text on paper (3.1:1); this is 4.6:1. */
  faint: "#6E727B",
  line: "#E6E3DD",
  cherry: "#CF3339",
  scene: "#1D1719",
  tint: "#F2F0EB",
} as const;

export const TRIAL_NOTE = "14 days on Professional. You won’t be charged until day 15 · Cancel anytime";

export function MarketingShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-[#FBFAF8] font-display text-[16px] leading-[1.55] text-[#15171C] antialiased md:text-[17px]">
      <MarketingNav />
      <main id="main-content" className="flex-1 [&>section:last-child]:pb-[88px] md:[&>section:last-child]:pb-[136px]">
        {children}
      </main>
      <MarketingFooter />
    </div>
  );
}

export function Container({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto w-full max-w-[1200px] px-5 md:px-8 ${className}`}>{children}</div>;
}

/** A page section. Space above it does the separating; there are no bands. */
export function Section({
  children, className = "", id, testId,
}: { children: ReactNode; className?: string; id?: string; testId?: string }) {
  return (
    <section id={id} data-testid={testId} className={`pt-24 md:pt-[152px] ${className}`}>
      {children}
    </section>
  );
}

/** The first band under the sticky nav. */
export function PageHero({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`pt-14 md:pt-16 ${className}`}>{children}</section>;
}

/** A short sentence-case label over a heading. */
export function Eyebrow({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <p className={`text-[15px] font-medium text-[#CF3339] ${className}`}>{children}</p>;
}

const DISPLAY = {
  hero: "max-w-[960px] text-[46px] leading-[1.0] tracking-[-0.035em] md:text-[64px] lg:text-[84px] lg:tracking-[-0.038em]",
  page: "max-w-[900px] text-[40px] leading-[1.03] tracking-[-0.033em] md:text-[52px] lg:text-[64px] lg:tracking-[-0.035em]",
};

export function Display({
  children, className = "", testId, size = "page",
}: { children: ReactNode; className?: string; testId?: string; size?: keyof typeof DISPLAY }) {
  return (
    <h1 data-testid={testId} className={`font-medium text-balance text-[#15171C] ${DISPLAY[size]} ${className}`}>
      {children}
    </h1>
  );
}

export function Heading({
  children, className = "", testId, as: Tag = "h2",
}: { children: ReactNode; className?: string; testId?: string; as?: "h2" | "h3" }) {
  const type = Tag === "h2"
    ? "max-w-[760px] text-[36px] leading-[1.05] tracking-[-0.032em] md:text-[52px]"
    : "text-[27px] leading-[1.12] tracking-[-0.025em] md:text-[34px]";
  return (
    <Tag data-testid={testId} className={`font-medium text-balance text-[#15171C] ${type} ${className}`}>
      {children}
    </Tag>
  );
}

/** Supporting copy under a heading. `size="hero"` is the larger lede under a page title. */
export function Lede({
  children, className = "", size = "sub",
}: { children: ReactNode; className?: string; size?: "sub" | "hero" }) {
  const type = size === "hero"
    ? "max-w-[640px] text-[18px] leading-[1.5] md:text-[21px]"
    : "max-w-[620px] text-[17px] leading-[1.55] md:text-[19px]";
  return <p className={`text-[#5C606A] ${type} ${className}`}>{children}</p>;
}

const BUTTON = {
  primary: "bg-[#15171C] text-white hover:bg-[#2A2D35]",
  secondary: "border border-[#D5D2CB] bg-white text-[#15171C] hover:border-[#15171C]",
};

export function ButtonLink({
  href, children, variant = "primary", testId, className = "",
}: {
  href: string;
  children: ReactNode;
  variant?: keyof typeof BUTTON;
  testId?: string;
  className?: string;
}) {
  return (
    <Link
      href={href}
      data-testid={testId}
      className={`inline-flex h-11 items-center justify-center whitespace-nowrap rounded-full px-[22px] text-[15px] font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#15171C] ${BUTTON[variant]} ${className}`}
    >
      {children}
    </Link>
  );
}

/** A row of pill buttons. On phones the pills share the width. */
export function Ctas({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`mt-7 flex flex-wrap gap-3 md:mt-8 [&>a]:flex-1 md:[&>a]:flex-none ${className}`}>{children}</div>;
}

/** Small print under a row of buttons. */
export function Note({ children, className = "", testId }: { children: ReactNode; className?: string; testId?: string }) {
  return <p data-testid={testId} className={`mt-[18px] text-[14px] text-[#6E727B] ${className}`}>{children}</p>;
}

/** An inline link inside running copy: ink with a hairline underline. */
export function TextLink({ href, children, testId, className = "" }: { href: string; children: ReactNode; testId?: string; className?: string }) {
  return (
    <Link
      href={href}
      data-testid={testId}
      className={`border-b border-[#CFCBC3] text-[#15171C] transition-colors hover:border-[#15171C] ${className}`}
    >
      {children}
    </Link>
  );
}

/** Form controls for the contact and demo pages. */
export const FORM = {
  label: "block text-[14px] font-medium text-[#15171C]",
  optional: "font-normal text-[#6E727B]",
  field:
    "mt-2 block w-full rounded-lg border bg-white px-3.5 text-[15px] text-[#15171C] placeholder:text-[#8A8E97] transition-colors focus:outline-none focus:ring-2 focus:ring-[#15171C]/10",
  border: "border-[#D5D2CB] hover:border-[#B5B1A9] focus:border-[#15171C]",
  invalid: "border-[#C2272D] focus:border-[#C2272D]",
  error: "mt-1.5 text-[14px] text-[#B42318]",
  alert: "border-l-2 border-[#C2272D] bg-[#FBF3F2] px-4 py-3 text-[14px] leading-relaxed text-[#8F1D22]",
  count: "mt-1.5 text-[13px] text-[#6E727B]",
  submit:
    "inline-flex h-12 w-full items-center justify-center rounded-full bg-[#15171C] px-6 text-[15px] font-medium text-white transition-colors hover:bg-[#2A2D35] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#15171C] disabled:cursor-not-allowed disabled:opacity-60",
};

function ScreenImg({ screen, priority, className }: { screen: ScreenSpec; priority: boolean; className: string }) {
  return (
    <img
      src={screen.src}
      alt={screen.alt}
      width={screen.width}
      height={screen.height}
      loading={priority ? "eager" : "lazy"}
      decoding="async"
      {...(priority ? { fetchpriority: "high" } : {})}
      className={`block h-auto max-w-none ${className}`}
    />
  );
}

/**
 * A product screen on a dark stage, cropped at the bottom. On phones the stage
 * runs edge to edge and shows the left of the screen at a readable size.
 * The full app window shows almost whole; a page crop (taller) is capped.
 */
export function Scene({
  screen, priority = false, className = "", testId,
}: { screen: ScreenSpec; priority?: boolean; className?: string; testId?: string }) {
  const height = screen.width / screen.height > 1.45 ? "md:h-auto" : "md:h-[520px] lg:h-[620px]";
  return (
    <figure
      data-testid={testId}
      className={`-mx-5 h-[420px] overflow-hidden bg-[#1D1719] pl-5 pt-9 md:mx-0 md:rounded-[28px] md:px-10 md:pt-10 lg:px-16 lg:pt-16 ${height} ${className}`}
    >
      <ScreenImg
        screen={screen}
        priority={priority}
        className="w-[760px] rounded-tl-[10px] shadow-[0_30px_80px_rgba(0,0,0,0.45)] md:-mb-[4%] md:w-full md:max-w-full md:rounded-t-[12px]"
      />
    </figure>
  );
}

/** One product screen on a soft tint, cropped right and bottom to its top-left corner. */
export function Shot({
  screen, priority = false, className = "", testId,
}: { screen: ScreenSpec; priority?: boolean; className?: string; testId?: string }) {
  return (
    <figure
      data-testid={testId}
      className={`h-[300px] overflow-hidden rounded-[18px] bg-[#F2F0EB] pl-6 pt-6 md:h-[460px] md:rounded-[22px] md:pl-10 md:pt-10 ${className}`}
    >
      <ScreenImg
        screen={screen}
        priority={priority}
        className="w-[560px] rounded-tl-[10px] shadow-[0_12px_40px_rgba(21,23,28,0.12)] md:w-[820px]"
      />
    </figure>
  );
}

/** A stack of copy-and-screen rows. */
export function Flow({ children, className = "", testId }: { children: ReactNode; className?: string; testId?: string }) {
  return <div data-testid={testId} className={`mt-12 flex flex-col gap-[72px] md:mt-20 md:gap-[120px] ${className}`}>{children}</div>;
}

/** Copy beside a product screen. `flip` puts the screen on the left on wide screens. */
export function Row({
  kicker, title, children, screen, flip = false, testId, id,
}: {
  kicker?: ReactNode;
  title: ReactNode;
  children: ReactNode;
  screen: ScreenSpec;
  flip?: boolean;
  testId?: string;
  id?: string;
}) {
  return (
    <div
      id={id}
      data-testid={testId}
      className={`grid items-center gap-7 lg:gap-[72px] ${flip ? "lg:grid-cols-[7fr_5fr]" : "lg:grid-cols-[5fr_7fr]"}`}
    >
      <div className={flip ? "lg:order-2" : ""}>
        {kicker && <p className="text-[15px] font-medium text-[#CF3339]">{kicker}</p>}
        <Heading as="h3" className={kicker ? "mt-3" : ""}>{title}</Heading>
        <div className="mt-4 text-[17px] leading-[1.6] text-[#5C606A] md:text-[17.5px] [&>p+p]:mt-3">{children}</div>
      </div>
      <Shot screen={screen} />
    </div>
  );
}

/** Two columns of product areas, each under a hairline. */
export function Areas({ children, className = "", testId }: { children: ReactNode; className?: string; testId?: string }) {
  return <div data-testid={testId} className={`mt-10 grid md:mt-16 md:grid-cols-2 md:gap-x-[72px] ${className}`}>{children}</div>;
}

export function Area({
  title, plan, children, href, testId,
}: { title: ReactNode; plan?: ReactNode; children: ReactNode; href?: string; testId?: string }) {
  return (
    <div data-testid={testId} className="border-t border-[#E6E3DD] pb-[26px] pt-[22px] md:pb-[34px] md:pt-[26px]">
      <h3 className="text-[20px] font-medium tracking-[-0.01em] text-[#15171C]">
        {href ? <Link href={href} className="transition-colors hover:text-[#5C606A]">{title}</Link> : title}
        {plan && <small className="ml-2 text-[13px] font-normal tracking-normal text-[#6E727B]">{plan}</small>}
      </h3>
      <p className="mt-2 max-w-[480px] text-[16.5px] leading-[1.55] text-[#5C606A]">{children}</p>
    </div>
  );
}

type CtaSpec = { href: string; label: string; testId?: string };

/** The closing call to action at the foot of a page. */
export function Closing({
  heading,
  body,
  primary = { href: "/signup", label: "Start your trial" },
  secondary = { href: "/demo", label: "Book a demo" },
  note = TRIAL_NOTE,
  testId = "section-cta",
  headingTestId,
}: {
  heading: ReactNode;
  body?: ReactNode;
  primary?: CtaSpec;
  secondary?: CtaSpec | null;
  note?: ReactNode | null;
  testId?: string;
  headingTestId?: string;
}) {
  return (
    <section data-testid={testId} className="pb-[88px] pt-[104px] md:pb-[136px] md:pt-[168px]">
      <Container>
        <h2
          data-testid={headingTestId}
          className="max-w-[820px] text-balance text-[40px] font-medium leading-[1.03] tracking-[-0.035em] text-[#15171C] md:text-[64px]"
        >
          {heading}
        </h2>
        {body && <Lede className="mt-5">{body}</Lede>}
        <Ctas>
          <ButtonLink href={primary.href} testId={primary.testId}>{primary.label}</ButtonLink>
          {secondary && <ButtonLink href={secondary.href} variant="secondary" testId={secondary.testId}>{secondary.label}</ButtonLink>}
        </Ctas>
        {note && <Note>{note}</Note>}
      </Container>
    </section>
  );
}

/** A labelled fact: a figure or short claim over a one-line explanation. */
export function Fact({ value, label, testId }: { value: ReactNode; label: ReactNode; testId?: string }) {
  return (
    <div data-testid={testId} className="border-t border-[#E6E3DD] pt-5">
      <p className="text-[32px] font-medium leading-none tracking-[-0.03em] text-[#15171C] md:text-[40px]">{value}</p>
      <p className="mt-2.5 text-[15px] leading-snug text-[#5C606A]">{label}</p>
    </div>
  );
}
