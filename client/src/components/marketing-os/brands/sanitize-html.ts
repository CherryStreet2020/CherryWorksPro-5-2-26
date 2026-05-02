/**
 * sanitizeSignatureHtml — brand signature live-preview sanitizer.
 *
 * The brand signature preview renders admin-entered HTML inside the
 * Marketing OS preview pane via `dangerouslySetInnerHTML`. We delegate
 * the actual HTML parsing and sanitization to DOMPurify (via
 * `isomorphic-dompurify` so it works in both the browser and the
 * Node-based vitest environment). This file is a thin wrapper that
 * configures the allowlist required by Sprint 2n.
 *
 * Allowlist:
 *   - tags: `p br strong em span a img`
 *   - attributes:
 *       `<a>`   — href (http/https/mailto/tel only)
 *       `<img>` — src (http/https/data:image only),
 *                 alt, width/height (numeric, up to 4 digits)
 *   - rejected: `script style iframe`, all `on*` event handlers, and
 *     any non-allowlisted scheme/attribute.
 *   - all sanitized `<a>` elements are forced to
 *     `target="_blank" rel="noopener noreferrer"`.
 *
 * NOT a general-purpose sanitizer; do not reuse outside this preview
 * use case without re-validating the configuration.
 */
import DOMPurify from "isomorphic-dompurify";

const ALLOWED_TAGS = ["p", "br", "strong", "em", "span", "a", "img"];
const ALLOWED_ATTR = ["href", "src", "alt", "width", "height", "target", "rel"];

const SAFE_ANCHOR_SCHEMES = /^(https?:|mailto:|tel:)/i;
const SAFE_IMG_SCHEMES = /^(https?:|data:image\/)/i;
const NUMERIC_DIM = /^\d{1,4}$/;

const ATTRS_BY_TAG: Record<string, Set<string>> = {
  a: new Set(["href", "target", "rel"]),
  img: new Set(["src", "alt", "width", "height"]),
};

let hooksRegistered = false;
function registerHooks(): void {
  if (hooksRegistered) return;

  DOMPurify.addHook("uponSanitizeAttribute", (node, data) => {
    const tag = node.nodeName.toLowerCase();
    const name = data.attrName.toLowerCase();
    const value = (data.attrValue ?? "").trim();

    const allowedForTag = ATTRS_BY_TAG[tag];
    if (!allowedForTag || !allowedForTag.has(name)) {
      data.keepAttr = false;
      return;
    }

    if (tag === "a" && name === "href" && !SAFE_ANCHOR_SCHEMES.test(value)) {
      data.keepAttr = false;
      return;
    }
    if (tag === "img" && name === "src" && !SAFE_IMG_SCHEMES.test(value)) {
      data.keepAttr = false;
      return;
    }
    if (tag === "img" && (name === "width" || name === "height") && !NUMERIC_DIM.test(value)) {
      data.keepAttr = false;
      return;
    }
  });

  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (node.nodeName === "A") {
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer");
    }
  });

  hooksRegistered = true;
}

export function sanitizeSignatureHtml(input: string): string {
  if (!input) return "";
  registerHooks();

  const cleaned = DOMPurify.sanitize(input, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
    ALLOW_UNKNOWN_PROTOCOLS: false,
    // Per-attribute scheme checks happen in the hook above. Use a
    // permissive base regex so DOMPurify doesn't strip data:image
    // before our hook can inspect it.
    ALLOWED_URI_REGEXP: /^.*$/,
    KEEP_CONTENT: true,
    RETURN_TRUSTED_TYPE: false,
  }) as string;

  // Tests and downstream consumers expect XHTML-style void tags.
  // We also defensively escape stray `&` characters (those that are
  // not already part of a numeric or named HTML entity) since some
  // DOMPurify serializer paths leave bare ampersands in text nodes.
  return cleaned
    .replace(/&(?!(?:[a-zA-Z][a-zA-Z0-9]*|#\d+|#x[0-9a-fA-F]+);)/g, "&amp;")
    .replace(/<br>/g, "<br />")
    .replace(/<img\b([^>]*?)(?<!\/)>/g, "<img$1 />");
}
