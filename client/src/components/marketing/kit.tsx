import type { ReactNode } from "react";
import { Link } from "wouter";
import { ArrowRight } from "lucide-react";
import { MarketingNav } from "@/components/marketing/marketing-nav";
import { MarketingFooter } from "@/components/marketing/marketing-footer";

/**
 * The public site's design kit. One light, editorial look for every marketing
 * page: warm paper background, ink headlines in the display serif, cherry used
 * only for the primary action and small marks. Pages compose these pieces
 * instead of hand-rolling colors, so the site reads as one product.
 *
 * Content is visible by default: nothing here hides a section until a scroll
 * observer fires, so pre-rendered HTML and slow devices never show blank bands.
 */

export const MK = {
  paper: "#FBFAF7",
  white: "#FFFFFF",
  ink: "#15171C",
  body: "#3D4350",
  muted: "#5F6672",
  line: "#E6E2DA",
  cherry: "#CF3339",
  cherryDark: "#B32A30",
  night: "#10141B",
} as const;

export function MarketingShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col bg-[#FBFAF7] text-[#3D4350] antialiased">
      <MarketingNav />
      <main id="main-content" className="flex-1">{children}</main>
      <MarketingFooter />
    </div>
  );
}

export function Container({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto w-full max-w-6xl px-5 sm:px-8 ${className}`}>{children}</div>;
}

type Tone = "paper" | "white" | "night";
const TONE: Record<Tone, string> = {
  paper: "bg-[#FBFAF7]",
  white: "bg-white border-y border-[#E6E2DA]",
  night: "bg-[#10141B] text-white/70",
};

export function Section({
  children, tone = "paper", className = "", id, testId,
}: { children: ReactNode; tone?: Tone; className?: string; id?: string; testId?: string }) {
  return (
    <section id={id} data-testid={testId} className={`py-20 md:py-28 ${TONE[tone]} ${className}`}>
      {children}
    </section>
  );
}

/** The first band under the fixed nav: clears it and keeps the hero tight to the top. */
export function PageHero({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`pt-32 md:pt-40 pb-16 md:pb-20 ${className}`}>{children}</section>;
}

export function Eyebrow({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <p className={`text-[13px] font-semibold uppercase tracking-[0.14em] text-[#B32A30] ${className}`}>{children}</p>
  );
}

export function Display({ children, className = "", testId }: { children: ReactNode; className?: string; testId?: string }) {
  return (
    <h1
      data-testid={testId}
      className={`font-display text-[2.6rem] leading-[1.06] sm:text-6xl md:text-[4.25rem] font-semibold tracking-[-0.02em] text-balance text-[#15171C] ${className}`}
    >
      {children}
    </h1>
  );
}

export function Heading({
  children, className = "", testId, as: Tag = "h2",
}: { children: ReactNode; className?: string; testId?: string; as?: "h2" | "h3" }) {
  return (
    <Tag
      data-testid={testId}
      className={`font-display text-3xl leading-[1.12] md:text-[2.75rem] font-semibold tracking-[-0.015em] text-balance text-[#15171C] ${className}`}
    >
      {children}
    </Tag>
  );
}

export function Lede({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <p className={`text-lg md:text-xl leading-relaxed text-[#3D4350] ${className}`}>{children}</p>;
}

type ButtonVariant = "primary" | "secondary" | "onNight";
const BUTTON: Record<ButtonVariant, string> = {
  primary: "bg-[#CF3339] text-white hover:bg-[#B32A30] shadow-[0_1px_0_rgba(0,0,0,0.08)]",
  secondary: "bg-white text-[#15171C] border border-[#D9D4CB] hover:border-[#15171C]",
  onNight: "bg-white/0 text-white border border-white/25 hover:border-white/60",
};

export function ButtonLink({
  href, children, variant = "primary", size = "md", testId, arrow = false, className = "",
}: {
  href: string;
  children: ReactNode;
  variant?: ButtonVariant;
  size?: "md" | "lg";
  testId?: string;
  arrow?: boolean;
  className?: string;
}) {
  const sizing = size === "lg" ? "h-12 px-6 text-[15px]" : "h-10 px-4 text-sm";
  return (
    <Link
      href={href}
      data-testid={testId}
      className={`inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#CF3339] ${sizing} ${BUTTON[variant]} ${className}`}
    >
      {children}
      {arrow && <ArrowRight className="h-4 w-4" aria-hidden="true" />}
    </Link>
  );
}

/** An inline text link with an arrow, for "Read more" style moves. */
export function TextLink({ href, children, testId, className = "" }: { href: string; children: ReactNode; testId?: string; className?: string }) {
  return (
    <Link
      href={href}
      data-testid={testId}
      className={`group inline-flex items-center gap-1.5 text-[15px] font-semibold text-[#15171C] underline decoration-[#CF3339]/40 underline-offset-[5px] hover:decoration-[#CF3339] ${className}`}
    >
      {children}
      <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
    </Link>
  );
}

/**
 * A real product screenshot in a quiet browser frame. Width and height are the
 * image's intrinsic pixels so the browser reserves the space before it loads.
 * `fade` dissolves the bottom edge, for captures that stop mid-page.
 */
export function Screenshot({
  src, alt, width, height, url, priority = false, fade = false, className = "", testId,
}: {
  src: string;
  alt: string;
  width: number;
  height: number;
  url?: string;
  priority?: boolean;
  fade?: boolean;
  className?: string;
  testId?: string;
}) {
  const mask = fade
    ? "[mask-image:linear-gradient(to_bottom,#000_72%,transparent)] [-webkit-mask-image:linear-gradient(to_bottom,#000_72%,transparent)]"
    : "";
  return (
    <figure
      data-testid={testId}
      className={`${mask} overflow-hidden rounded-xl border border-[#E1DCD3] bg-white shadow-[0_1px_2px_rgba(16,20,27,0.04),0_12px_32px_-8px_rgba(16,20,27,0.14),0_32px_64px_-24px_rgba(16,20,27,0.18)] ${className}`}
    >
      <div className="flex h-8 items-center gap-1.5 border-b border-[#ECE8E1] bg-[#F7F5F1] px-3" aria-hidden="true">
        <span className="h-2.5 w-2.5 rounded-full bg-[#DDD8CF]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#DDD8CF]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#DDD8CF]" />
        {url && (
          <span className="ml-3 hidden truncate rounded-md bg-white px-2.5 py-0.5 text-[11px] text-[#7A808B] ring-1 ring-[#ECE8E1] sm:block">
            {url}
          </span>
        )}
      </div>
      <img
        src={src}
        alt={alt}
        width={width}
        height={height}
        loading={priority ? "eager" : "lazy"}
        decoding="async"
        {...(priority ? { fetchpriority: "high" } : {})}
        className="block h-auto w-full"
      />
    </figure>
  );
}

/** A labelled fact: a figure or short claim over a one-line explanation. */
export function Fact({ value, label, testId }: { value: ReactNode; label: ReactNode; testId?: string }) {
  return (
    <div data-testid={testId}>
      <p className="font-display text-3xl md:text-4xl font-semibold tracking-tight text-[#15171C]">{value}</p>
      <p className="mt-1.5 text-sm leading-snug text-[#5F6672]">{label}</p>
    </div>
  );
}
