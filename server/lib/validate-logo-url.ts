/**
 * Logo URL validator (task #160).
 *
 * The brand editor's LogoDropzone has a "paste a URL" path that writes
 * whatever string an admin types straight into `brand.logoUrl`. Without
 * validation this is an XSS vector (javascript:/data: schemes), an SSRF
 * vector (http://169.254.169.254/...), and a hotlinking foot-gun
 * (arbitrary HTML pages, 404s, missing assets).
 *
 * `validateExternalLogoUrl` enforces:
 *   - http(s) scheme only (no javascript:, data:, file:, etc.)
 *   - no URL-embedded credentials
 *   - hostname does not resolve to a private/loopback/link-local/CGNAT/
 *     multicast/reserved address (basic SSRF guard)
 *   - HEAD (or short GET) returns 2xx and an allowed image content-type
 *   - redirects are NOT followed (a follow could land on a private IP)
 *
 * `data:` URLs and our own hosted `/api/public-objects/brand-logos/...`
 * URLs are intentionally exempt — they go through this module's
 * `isExemptLogoUrl` helper instead of the network validator.
 */
import dns from "node:dns/promises";
import net from "node:net";

const ALLOWED_CONTENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);
const FETCH_TIMEOUT_MS = 5000;
const HOSTED_LOGO_PATH = "/api/public-objects/brand-logos/";

export interface LogoUrlValidationResult {
  ok: boolean;
  message?: string;
}

/**
 * Origins that count as "this app" for the purposes of recognising a
 * hosted logo URL. Includes APP_BASE_URL/BASE_URL plus every entry of
 * REPLIT_DOMAINS. Anything not on this list is treated as external —
 * even if its path begins with /api/public-objects/brand-logos/ — so
 * an attacker cannot bypass validation by spoofing the path on their
 * own domain (e.g. https://evil.tld/api/public-objects/brand-logos/x).
 */
function trustedOrigins(): Set<string> {
  const out = new Set<string>();
  const tryAdd = (raw: string | undefined) => {
    if (!raw) return;
    try {
      out.add(new URL(raw).origin);
    } catch {
      /* ignore garbage env values */
    }
  };
  tryAdd(process.env.APP_BASE_URL);
  tryAdd(process.env.BASE_URL);
  const domains = process.env.REPLIT_DOMAINS?.split(",") ?? [];
  for (const d of domains) {
    const trimmed = d.trim();
    if (trimmed) tryAdd(`https://${trimmed}`);
  }
  return out;
}

/**
 * Returns true if the given logoUrl does not require network validation:
 *   - empty/null
 *   - data:image/* values (admin pasted base64; sanitiser on render side
 *     handles SVG-in-data-url separately)
 *   - relative hosted paths under /api/public-objects/brand-logos/
 *   - absolute URLs whose origin matches a trusted app origin AND whose
 *     pathname is the hosted logo prefix
 *
 * Crucially this does NOT exempt arbitrary absolute URLs that happen to
 * carry the hosted path (e.g. https://attacker.tld/api/public-objects/
 * brand-logos/foo.png) — those still go through full SSRF + content-type
 * validation.
 */
export function isExemptLogoUrl(value: string | null | undefined): boolean {
  if (!value) return true;
  if (value.startsWith("data:image/")) return true;
  if (value.startsWith(HOSTED_LOGO_PATH)) return true;
  try {
    const u = new URL(value);
    if (
      u.pathname.startsWith(HOSTED_LOGO_PATH) &&
      trustedOrigins().has(u.origin)
    ) {
      return true;
    }
  } catch {
    /* not a parseable absolute URL; fall through */
  }
  return false;
}

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return true;
  const [a, b] = parts;
  if (a === 0) return true;                       // "this network"
  if (a === 10) return true;                      // RFC1918
  if (a === 127) return true;                     // loopback
  if (a === 169 && b === 254) return true;        // link-local
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
  if (a === 192 && b === 168) return true;        // RFC1918
  if (a === 192 && b === 0) return true;          // IETF protocol assignments
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true;                      // multicast / reserved
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "::") return true;
  if (lower.startsWith("fe80:")) return true;     // link-local
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // ULA
  if (lower.startsWith("ff")) return true;        // multicast
  const v4mapped = lower.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (v4mapped) return isPrivateIPv4(v4mapped[1]);
  return false;
}

async function isHostBlocked(hostname: string): Promise<boolean> {
  if (net.isIP(hostname)) {
    return net.isIPv4(hostname)
      ? isPrivateIPv4(hostname)
      : isPrivateIPv6(hostname);
  }
  const lc = hostname.toLowerCase();
  if (
    lc === "localhost" ||
    lc.endsWith(".localhost") ||
    lc.endsWith(".local") ||
    lc.endsWith(".internal")
  ) {
    return true;
  }
  try {
    const addrs = await dns.lookup(hostname, { all: true });
    if (addrs.length === 0) return true;
    for (const a of addrs) {
      if (a.family === 4 && isPrivateIPv4(a.address)) return true;
      if (a.family === 6 && isPrivateIPv6(a.address)) return true;
    }
  } catch {
    return true;
  }
  return false;
}

/**
 * Allow tests to swap in a fake fetch without monkey-patching globalThis.
 */
type FetchLike = typeof fetch;

export async function validateExternalLogoUrl(
  rawUrl: string,
  opts: { fetchImpl?: FetchLike } = {},
): Promise<LogoUrlValidationResult> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, message: "Logo URL is not a valid URL" };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, message: "Logo URL must use http or https" };
  }
  if (url.username || url.password) {
    return { ok: false, message: "Logo URL must not contain credentials" };
  }
  if (await isHostBlocked(url.hostname)) {
    return {
      ok: false,
      message: "Logo URL host is not reachable from the public internet",
    };
  }

  const fetchImpl = opts.fetchImpl ?? fetch;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  try {
    let res = await fetchImpl(url, {
      method: "HEAD",
      redirect: "manual",
      signal: ac.signal,
    });
    if (res.status >= 300 && res.status < 400) {
      return {
        ok: false,
        message: "Logo URL redirects; provide the final URL instead",
      };
    }
    // Some hosts disallow HEAD or omit Content-Type on HEAD; fall back to
    // a 1-byte ranged GET to sniff the content-type.
    if (!res.ok || !res.headers.get("content-type")) {
      res = await fetchImpl(url, {
        method: "GET",
        redirect: "manual",
        signal: ac.signal,
        headers: { Range: "bytes=0-0" },
      });
      if (res.status >= 300 && res.status < 400) {
        return {
          ok: false,
          message: "Logo URL redirects; provide the final URL instead",
        };
      }
    }
    if (!res.ok && res.status !== 206) {
      return { ok: false, message: `Logo URL returned HTTP ${res.status}` };
    }
    const ct = (res.headers.get("content-type") || "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    if (!ALLOWED_CONTENT_TYPES.has(ct)) {
      return {
        ok: false,
        message: `Logo URL must be an image (jpeg/png/gif/webp); got "${ct || "unknown"}"`,
      };
    }
    return { ok: true };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { ok: false, message: "Logo URL fetch timed out" };
    }
    return { ok: false, message: "Logo URL could not be fetched" };
  } finally {
    clearTimeout(timer);
  }
}
