/**
 * Brand signature live preview sanitizer — adversarial coverage.
 *
 * The preview renders admin-entered HTML via dangerouslySetInnerHTML,
 * so the inline allowlist sanitizer in
 * client/src/components/marketing-os/brands/sanitize-html.ts must hold
 * up against script injection, javascript:/data:/vbscript: schemes,
 * mixed-case scheme tricks, and event-handler attribute injection.
 */
import { describe, it, expect } from "vitest";
import { sanitizeSignatureHtml } from "@/components/marketing-os/brands/sanitize-html";

describe("sanitizeSignatureHtml — script injection", () => {
  it("strips bare <script> blocks", () => {
    const out = sanitizeSignatureHtml('<script>alert(1)</script>');
    expect(out.toLowerCase()).not.toContain("<script");
    expect(out).not.toContain("alert(1)");
  });

  it("strips <script> with attributes and surrounding content", () => {
    const out = sanitizeSignatureHtml(
      'hi<script type="text/javascript">window.x=1</script>bye',
    );
    expect(out.toLowerCase()).not.toContain("<script");
    expect(out).not.toContain("window.x=1");
    expect(out).toContain("hi");
    expect(out).toContain("bye");
  });

  it("strips <style> and <iframe> blocks", () => {
    const out = sanitizeSignatureHtml(
      '<style>body{display:none}</style><iframe src="https://evil.example"></iframe>ok',
    );
    expect(out.toLowerCase()).not.toContain("<style");
    expect(out.toLowerCase()).not.toContain("<iframe");
    expect(out).toContain("ok");
  });

  it("drops disallowed tags entirely (object, embed, svg, math)", () => {
    const out = sanitizeSignatureHtml(
      '<object data="x"></object><embed src="x"><svg onload="alert(1)"></svg><math></math>safe',
    );
    expect(out.toLowerCase()).not.toContain("<object");
    expect(out.toLowerCase()).not.toContain("<embed");
    expect(out.toLowerCase()).not.toContain("<svg");
    expect(out.toLowerCase()).not.toContain("<math");
    expect(out).toContain("safe");
  });
});

describe("sanitizeSignatureHtml — anchor scheme allowlist", () => {
  it("rejects javascript: hrefs", () => {
    const out = sanitizeSignatureHtml('<a href="javascript:alert(1)">x</a>');
    expect(out.toLowerCase()).not.toContain("javascript:");
    expect(out).toContain(">x</a>");
  });

  it("rejects mixed-case JaVaScRiPt: hrefs", () => {
    const out = sanitizeSignatureHtml('<a href="JaVaScRiPt:alert(1)">x</a>');
    expect(out.toLowerCase()).not.toContain("javascript:");
  });

  it("rejects vbscript: hrefs", () => {
    const out = sanitizeSignatureHtml('<a href="vbscript:msgbox(1)">x</a>');
    expect(out.toLowerCase()).not.toContain("vbscript:");
  });

  it("rejects data: hrefs", () => {
    const out = sanitizeSignatureHtml('<a href="data:text/html,<b>x</b>">x</a>');
    expect(out.toLowerCase()).not.toContain("data:");
  });

  it("rejects file: hrefs", () => {
    const out = sanitizeSignatureHtml('<a href="file:///etc/passwd">x</a>');
    expect(out.toLowerCase()).not.toContain("file:");
  });

  it("rejects href with leading whitespace before javascript:", () => {
    const out = sanitizeSignatureHtml('<a href="  javascript:alert(1)">x</a>');
    expect(out.toLowerCase()).not.toContain("javascript:");
  });

  it("preserves http/https hrefs", () => {
    const out = sanitizeSignatureHtml('<a href="https://example.com">x</a>');
    expect(out).toContain('href="https://example.com"');
  });

  it("preserves mailto: hrefs", () => {
    const out = sanitizeSignatureHtml('<a href="mailto:hi@example.com">x</a>');
    expect(out).toContain('href="mailto:hi@example.com"');
  });

  it("preserves tel: hrefs", () => {
    const out = sanitizeSignatureHtml('<a href="tel:+15551234567">x</a>');
    expect(out).toContain('href="tel:+15551234567"');
  });

  it("forces target=_blank rel=noopener noreferrer on safe anchors", () => {
    const out = sanitizeSignatureHtml('<a href="https://example.com">x</a>');
    expect(out).toContain('rel="noopener noreferrer"');
    expect(out).toContain('target="_blank"');
  });
});

describe("sanitizeSignatureHtml — event handler & attribute injection", () => {
  it("strips onerror on img", () => {
    const out = sanitizeSignatureHtml(
      '<img src="https://example.com/a.png" onerror="alert(1)" />',
    );
    expect(out.toLowerCase()).not.toContain("onerror");
    expect(out).not.toContain("alert(1)");
    expect(out).toContain('src="https://example.com/a.png"');
  });

  it("strips onclick on anchor", () => {
    const out = sanitizeSignatureHtml(
      '<a href="https://example.com" onclick="alert(1)">x</a>',
    );
    expect(out.toLowerCase()).not.toContain("onclick");
    expect(out).not.toContain("alert(1)");
  });

  it("strips ONMOUSEOVER (uppercase) on span", () => {
    const out = sanitizeSignatureHtml('<span ONMOUSEOVER="alert(1)">x</span>');
    expect(out.toLowerCase()).not.toContain("onmouseover");
    expect(out).not.toContain("alert(1)");
  });

  it("strips disallowed attributes (style, class, id) on allowed tags", () => {
    const out = sanitizeSignatureHtml(
      '<span style="color:red" class="x" id="y">x</span>',
    );
    expect(out).not.toContain("style=");
    expect(out).not.toContain("class=");
    expect(out).not.toContain("id=");
    expect(out).toContain("<span>x</span>");
  });

  it("rejects javascript: in img src", () => {
    const out = sanitizeSignatureHtml('<img src="javascript:alert(1)" />');
    expect(out.toLowerCase()).not.toContain("javascript:");
    expect(out.toLowerCase()).not.toContain("src=");
  });

  it("rejects non-image data: URI in img src", () => {
    const out = sanitizeSignatureHtml(
      '<img src="data:text/html,<script>alert(1)</script>" />',
    );
    expect(out.toLowerCase()).not.toContain("data:text/html");
  });

  it("preserves data:image/png in img src", () => {
    const out = sanitizeSignatureHtml(
      '<img src="data:image/png;base64,iVBORw0KG" />',
    );
    expect(out).toContain('src="data:image/png;base64,iVBORw0KG"');
  });

  it("rejects non-numeric width/height on img", () => {
    const out = sanitizeSignatureHtml(
      '<img src="https://example.com/a.png" width="100;evil" height="abc" />',
    );
    expect(out).not.toContain("width=");
    expect(out).not.toContain("height=");
    expect(out).toContain('src="https://example.com/a.png"');
  });

  it("preserves numeric width/height on img", () => {
    const out = sanitizeSignatureHtml(
      '<img src="https://example.com/a.png" width="120" height="40" />',
    );
    expect(out).toContain('width="120"');
    expect(out).toContain('height="40"');
  });
});

describe("sanitizeSignatureHtml — malformed / unquoted attributes", () => {
  it("handles unquoted javascript: href and rejects it", () => {
    const out = sanitizeSignatureHtml('<a href=javascript:alert(1)>x</a>');
    expect(out.toLowerCase()).not.toContain("javascript:");
  });

  it("handles unquoted safe href and preserves it", () => {
    const out = sanitizeSignatureHtml('<a href=https://example.com>x</a>');
    expect(out).toContain('href="https://example.com"');
  });

  it("handles single-quoted href values", () => {
    const out = sanitizeSignatureHtml("<a href='https://example.com'>x</a>");
    expect(out).toContain('href="https://example.com"');
  });

  it("escapes stray < and > outside of tags", () => {
    const out = sanitizeSignatureHtml("3 < 5 and 6 > 4");
    expect(out).toContain("&lt;");
    expect(out).toContain("&gt;");
  });

  it("escapes & in text content", () => {
    const out = sanitizeSignatureHtml("Tom & Jerry");
    expect(out).toContain("Tom &amp; Jerry");
  });

  it("strips HTML comments (including conditional comment style)", () => {
    const out = sanitizeSignatureHtml(
      "<!-- <script>alert(1)</script> --><strong>ok</strong>",
    );
    expect(out.toLowerCase()).not.toContain("<script");
    expect(out).not.toContain("alert(1)");
    expect(out).toContain("<strong>ok</strong>");
  });

  it("returns empty string for empty input", () => {
    expect(sanitizeSignatureHtml("")).toBe("");
  });
});

describe("sanitizeSignatureHtml — benign signatures preserved", () => {
  it("preserves a typical signature with bold, italic, br, and a safe anchor", () => {
    const input =
      '<p><strong>Jane Doe</strong><br /><em>VP, Sales</em><br /><a href="https://example.com">example.com</a></p>';
    const out = sanitizeSignatureHtml(input);
    expect(out).toContain("<p>");
    expect(out).toContain("<strong>Jane Doe</strong>");
    expect(out).toContain("<em>VP, Sales</em>");
    expect(out).toContain("<br />");
    expect(out).toContain('href="https://example.com"');
    expect(out).toContain(">example.com</a>");
  });

  it("preserves spans and paragraphs as plain wrappers", () => {
    const out = sanitizeSignatureHtml("<p><span>hello</span></p>");
    expect(out).toBe("<p><span>hello</span></p>");
  });
});
