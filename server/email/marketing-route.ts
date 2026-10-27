/**
 * Which transport carries a marketing send (campaign broadcast or sequence
 * step): the org's connected mailbox, as always, or Azure Communication
 * Services Email for the operator's own `hello@news.<brand>` senders.
 *
 * ACS only when all three hold: `ACS_EMAIL_ENDPOINT` is set, the org's slug is
 * in `ACS_EMAIL_ORG_SLUGS`, and the effective sender is in `ACS_EMAIL_SENDERS`
 * (exact addresses, not domains). The org allowlist is the tenant guard: a
 * customer typing an operator address still goes to its own mailbox.
 *
 * Pure apart from reading env. Transactional and platform mail never come here.
 */

/**
 * The characters stripped from both ends of a sender before routing: exactly
 * the code points JavaScript's `\s` matches. The TS strip and the SQL
 * `regexp_replace` pattern are both generated from this one list, so the
 * worker's SQL fairness filter and the TS router agree on every input.
 */
export const WS: readonly number[] = [
  0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20, 0xa0, 0x1680,
  0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a,
  0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff,
];

function charClass(): string {
  return WS.map((cp) => `\\u{${cp.toString(16)}}`).join("");
}

const STRIP_RE = new RegExp(`^[${charClass()}]+|[${charClass()}]+$`, "gu");

/**
 * The same strip as a POSIX regex for Postgres `regexp_replace(x, $1, '', 'g')`.
 * Characters are embedded literally (none of them is special inside a bracket).
 */
export const WS_SQL_PATTERN: string = (() => {
  const cls = WS.map((cp) => String.fromCodePoint(cp)).join("");
  return `^[${cls}]+|[${cls}]+$`;
})();

export function stripWs(value: string): string {
  return value.replace(STRIP_RE, "");
}

/**
 * `item.from` if it is non-empty after stripping, else the brand's, lower-cased.
 * Null when neither has an address. Mirrors the SQL in the worker's fairness filter:
 * `lower(coalesce(nullif(strip(item), ''), strip(brand)))`.
 */
export function effectiveMarketingSender(
  itemFrom: string | null | undefined,
  brandFrom: string | null | undefined,
): string | null {
  const item = itemFrom == null ? null : stripWs(itemFrom);
  if (item) return item.toLowerCase();
  if (brandFrom == null) return null;
  return stripWs(brandFrom).toLowerCase();
}

export interface AcsRoutingConfig {
  endpoint: string | null;
  orgSlugs: string[];
  senders: string[];
}

let warnedMalformed = false;

function parseList(raw: string | undefined, label: string, check: (v: string) => boolean): string[] {
  const values = (raw ?? "")
    .split(",")
    .map((v) => stripWs(v).toLowerCase())
    .filter((v) => v.length > 0);
  if (values.some((v) => !check(v))) {
    if (!warnedMalformed) {
      warnedMalformed = true;
      console.error(`[acs] ${label} is malformed; ACS marketing routing is off`);
    }
    return [];
  }
  return values;
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;
const ADDRESS_RE = /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/;

export function readAcsRoutingConfig(env: NodeJS.ProcessEnv = process.env): AcsRoutingConfig {
  const endpoint = stripWs(env.ACS_EMAIL_ENDPOINT ?? "") || null;
  return {
    endpoint,
    orgSlugs: parseList(env.ACS_EMAIL_ORG_SLUGS, "ACS_EMAIL_ORG_SLUGS", (v) => SLUG_RE.test(v)),
    senders: parseList(env.ACS_EMAIL_SENDERS, "ACS_EMAIL_SENDERS", (v) => ADDRESS_RE.test(v)),
  };
}

export type MarketingRoute = "acs" | "connected";

export function resolveMarketingRoute(
  org: { slug?: string | null } | null | undefined,
  effectiveFrom: string | null,
  config: AcsRoutingConfig = readAcsRoutingConfig(),
): MarketingRoute {
  if (!config.endpoint || !org?.slug || !effectiveFrom) return "connected";
  if (!config.orgSlugs.includes(org.slug.toLowerCase())) return "connected";
  if (!config.senders.includes(stripWs(effectiveFrom).toLowerCase())) return "connected";
  return "acs";
}

/** For tests: re-arm the once-only malformed-config log. */
export function resetMarketingRouteWarningsForTests(): void {
  warnedMalformed = false;
}
