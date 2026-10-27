/**
 * First-party open + click tracking for marketing campaigns.
 *
 * Resend reported opens and clicks; a connected mailbox (Graph / Gmail /
 * SMTP) reports nothing, so the send itself carries the signals:
 *
 *   - a 1x1 pixel  → GET /api/public/email/o/<token>.gif
 *   - every http(s) link in the campaign body is rewritten to
 *                    GET /api/public/email/c/<token>/<index>
 *
 * <token> is minted per send (email_tracking_links.token). The click route
 * redirects only to email_tracking_links.links[index],
 * the list this function extracted from the body as sent — the destination is
 * never read from the request, so the route cannot be used as an open redirect.
 */
import { randomBytes } from "crypto";
import { parse } from "parse5";
import { escapeHtml, publicBaseUrl } from "./unsubscribe";

const TOKEN_RE = /^[A-Za-z0-9_-]{32}$/;
/** Links past this many in one body are left as they are (not tracked). */
export const MAX_TRACKED_LINKS = 100;

export function newTrackingToken(): string {
  return randomBytes(24).toString("base64url");
}

export function isTrackingToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN_RE.test(value);
}

export function trackingClickUrl(token: string, index: number): string {
  return `${publicBaseUrl()}/api/public/email/c/${token}/${index}`;
}

export function trackingPixelUrl(token: string): string {
  return `${publicBaseUrl()}/api/public/email/o/${token}.gif`;
}

export function trackingPixelHtml(token: string): string {
  return (
    `<img src="${escapeHtml(trackingPixelUrl(token))}" width="1" height="1" alt="" ` +
    `style="display:block;border:0;width:1px;height:1px;overflow:hidden">`
  );
}

/**
 * Trim the way the URL parser does — only U+0000–U+0020 at either end —
 * not String#trim, which also drops U+00A0 and other Unicode spaces the
 * browser keeps (percent-encoded) in the destination.
 */
function stripC0OrSpace(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && value.charCodeAt(start) <= 0x20) start++;
  while (end > start && value.charCodeAt(end - 1) <= 0x20) end--;
  return value.slice(start, end);
}

/**
 * The destination a tracked link may redirect to: an absolute http(s) URL
 * that is not one of our own unsubscribe / public-API links (those must keep
 * working without a tracking hop, and wrapping them would hide the opt-out).
 * `href` is the attribute value as the HTML parser decoded it.
 */
export function trackableUrl(href: string): string | null {
  const value = stripC0OrSpace(href);
  if (!/^https?:\/\//i.test(value)) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  const path = url.pathname.toLowerCase();
  if (path.startsWith("/unsubscribe/") || path.startsWith("/api/public/")) return null;
  return url.toString();
}

const HTML_NS = "http://www.w3.org/1999/xhtml";

type ParsedNode = {
  nodeName: string;
  tagName?: string;
  namespaceURI?: string;
  attrs?: { name: string; value: string }[];
  childNodes?: ParsedNode[];
  sourceCodeLocation?: {
    attrs?: Record<string, { startOffset: number; endOffset: number }>;
    endTag?: { startOffset: number };
  } | null;
};

/** Where the per-send pieces go in a body: everything else is copied as written. */
type TrackingPlan = {
  /** The body cut at each rewritten href; link N sits between parts N and N+1. */
  parts: string[];
  links: string[];
  /** Offset into the last part for the pixel, or null when it cannot be placed safely. */
  pixelAt: number | null;
};

function walkElements(node: ParsedNode, visit: (el: ParsedNode) => void): void {
  // <template> content lives on `.content`, not `.childNodes`, so it is never
  // visited: a browser does not render it either. Iterative, in document
  // order: a body of unclosed tags nests thousands deep.
  const stack = [...(node.childNodes ?? [])].reverse();
  for (let n = stack.pop(); n; n = stack.pop()) {
    if (n.tagName) visit(n);
    const kids = n.childNodes ?? [];
    for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
  }
}

function parseHtml(html: string): ParsedNode {
  return parse(html, { sourceCodeLocationInfo: true }) as unknown as ParsedNode;
}

/** True when `html` holds the pixel as a real <img> element (not text, a comment or an attribute). */
function hasPixelElement(html: string, src: string): boolean {
  let found = false;
  walkElements(parseHtml(html), (el) => {
    if (el.tagName === "img" && el.namespaceURI === HTML_NS
      && el.attrs?.find((a) => a.name === "src")?.value === src) found = true;
  });
  return found;
}

const PLACEHOLDER_TOKEN = "A".repeat(32);

/**
 * Parse the body once with the HTML spec parser (parse5, the parser jsdom
 * uses) and find, by source offset, every <a href> a mail client would follow
 * and the spot for the pixel. Only those offsets are edited; text, comments,
 * other attributes, <textarea>, <script> and <template> content are left
 * byte for byte, so `<div title="<a href=...>">` stays a title.
 */
function planTracking(html: string): TrackingPlan {
  const doc = parseHtml(html);
  const edits: { start: number; end: number; dest: string }[] = [];
  let bodyEnd: number | null = null;
  walkElements(doc, (el) => {
    if (el.namespaceURI !== HTML_NS) return;
    if (el.tagName === "body" && el.sourceCodeLocation?.endTag) {
      bodyEnd ??= el.sourceCodeLocation.endTag.startOffset;
      return;
    }
    if (el.tagName !== "a") return;
    const href = el.attrs?.find((a) => a.name === "href");
    const loc = el.sourceCodeLocation?.attrs?.href;
    if (!href || !loc) return;
    const dest = trackableUrl(href.value);
    if (dest) edits.push({ start: loc.startOffset, end: loc.endOffset, dest });
  });
  edits.sort((a, b) => a.start - b.start);

  // The parser can build several elements from one start tag (misnested
  // formatting like `<b><a href=…>one</b>two</a>` reopens the <a>), so
  // several anchors may share a source span: each span is rewritten once.
  const parts: string[] = [];
  const links: string[] = [];
  let pos = 0;
  for (const e of edits) {
    if (e.start < pos) continue;
    if (links.length >= MAX_TRACKED_LINKS) break;
    parts.push(html.slice(pos, e.start));
    links.push(e.dest);
    pos = e.end;
  }
  const tail = html.slice(pos);
  parts.push(tail);
  const plan: TrackingPlan = { parts, links, pixelAt: null };

  // Before </body> when the body closes, else at the end — then check the
  // pixel parses as an element: a body ending inside an unclosed comment,
  // <textarea> or <script> would swallow it, so that send goes without one.
  const at = bodyEnd !== null && bodyEnd >= pos ? bodyEnd - pos : tail.length;
  const probe = renderPlan({ ...plan, pixelAt: at }, PLACEHOLDER_TOKEN);
  if (hasPixelElement(probe, trackingPixelUrl(PLACEHOLDER_TOKEN))) plan.pixelAt = at;
  return plan;
}

function renderPlan(plan: TrackingPlan, token: string): string {
  let out = plan.parts[0];
  for (let i = 0; i < plan.links.length; i++) {
    out += `href="${escapeHtml(trackingClickUrl(token, i))}"` + plan.parts[i + 1];
  }
  if (plan.pixelAt === null) return out;
  const tail = plan.parts[plan.parts.length - 1];
  const cut = out.length - tail.length + plan.pixelAt;
  return out.slice(0, cut) + trackingPixelHtml(token) + out.slice(cut);
}

// A campaign sends the same body to every recipient, and a sequence tick
// interleaves a few step bodies; parse each once. A body the parser cannot
// handle (parse5 recurses on some deep nestings) is remembered as such too,
// so it is not re-parsed for every recipient.
const PLAN_CACHE_SIZE = 32;
const planCache = new Map<string, TrackingPlan | Error>();

function trackingPlanFor(html: string): TrackingPlan {
  let plan = planCache.get(html);
  if (plan === undefined) {
    try {
      plan = planTracking(html);
    } catch (err) {
      plan = err instanceof Error ? err : new Error(String(err));
    }
    if (planCache.size >= PLAN_CACHE_SIZE) planCache.delete(planCache.keys().next().value!);
    planCache.set(html, plan);
  }
  if (plan instanceof Error) throw plan;
  return plan;
}

/**
 * A campaign or sequence-step body as it goes to one recipient: every trackable link
 * rewritten to /api/public/email/c/<token>/N (N indexes the returned `links`,
 * stored for the send) and the pixel added before </body>, or at the end of
 * a fragment. The unsubscribe footer is appended by the caller AFTER this,
 * so it is never rewritten. Throws when the body cannot be parsed; the
 * caller then sends it untracked.
 */
export function withTracking(html: string, token: string): { html: string; links: string[] } {
  const plan = trackingPlanFor(html);
  return { html: renderPlan(plan, token), links: [...plan.links] };
}
