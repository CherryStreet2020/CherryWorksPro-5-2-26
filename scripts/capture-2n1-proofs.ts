import { chromium } from "playwright";
import * as path from "path";
import * as fs from "fs";

const BASE = `http://localhost:${process.env.PORT || 5000}`;
// Credentials are read from the environment so we don't bake test passwords
// into the repo. The dev workflow sets these the same way `e2e/global-setup.ts`
// resets them, and the script fails fast if either is missing.
const ADMIN_EMAIL = process.env.PROOF_ADMIN_EMAIL ?? process.env.ADMIN_EMAIL;
const ADMIN_PASS = process.env.PROOF_ADMIN_PASSWORD ?? process.env.ADMIN_PASSWORD;
const ORG_SLUG = process.env.PROOF_ORG_SLUG ?? "cherry-st";
if (!ADMIN_EMAIL || !ADMIN_PASS) {
  console.error(
    "[capture-2n1-proofs] PROOF_ADMIN_EMAIL and PROOF_ADMIN_PASSWORD are required."
  );
  process.exit(2);
}
const OUT_DIR = path.resolve("proof/2n1");
const WIDTHS = [1280, 1366, 1440, 1920];
const ALLOWED_THEMES = new Set(["light", "dark"]);
const THEMES: Array<"light" | "dark"> = (() => {
  const raw = process.env.THEMES?.split(",").map((s) => s.trim()).filter(Boolean);
  if (!raw || raw.length === 0) return ["light", "dark"];
  for (const t of raw) {
    if (!ALLOWED_THEMES.has(t)) {
      console.error(`[capture-2n1-proofs] invalid theme '${t}' (allowed: light, dark)`);
      process.exit(2);
    }
  }
  return raw as Array<"light" | "dark">;
})();
const HEIGHT = 800;

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();

  for (const theme of THEMES) {
    for (const width of WIDTHS) {
      const ctx = await browser.newContext({
        viewport: { width, height: HEIGHT },
        baseURL: BASE,
      });
      const page = await ctx.newPage();

      await page.addInitScript(({ t, slug }) => {
        try {
          localStorage.setItem("cherryworks_theme", t);
          localStorage.setItem("lastOrgSlug", slug);
        } catch {}
      }, { t: theme, slug: ORG_SLUG });

      await page.goto("/login", { waitUntil: "domcontentloaded" });
      await page.fill('[data-testid="input-email"]', ADMIN_EMAIL);
      await page.fill('[data-testid="input-password"]', ADMIN_PASS);
      await page.click('[data-testid="button-login"]');
      await page.waitForURL((u) => !u.toString().includes("/login"), { timeout: 30000 });

      await page.waitForTimeout(800);
      await page.goto(`${BASE}/settings/brands`, { waitUntil: "load" });
      await page.waitForLoadState("networkidle").catch(() => {});
      console.log(`>> ${theme}@${width} url after goto: ${page.url()}`);
      try {
        await page.waitForSelector('[data-testid="button-add-brand"]', { timeout: 30000 });
      } catch (e) {
        const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 800));
        console.log("DEBUG url=", page.url());
        console.log("DEBUG body=", bodyText);
        await page.screenshot({ path: `/tmp/debug-${theme}-${width}.png`, fullPage: true });
        throw e;
      }
      await page.click('[data-testid="button-add-brand"]');

      const dialog = page.locator('[role="dialog"]').first();
      await dialog.waitFor({ state: "visible", timeout: 10000 });
      await page.waitForTimeout(400);

      await dialog.evaluate((el) => {
        const scroller =
          (el.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement | null) ||
          (el.matches(':scope') ? (el as HTMLElement) : null) ||
          (el as HTMLElement);
        const target = scroller && scroller.scrollHeight > scroller.clientHeight ? scroller : (el as HTMLElement);
        target.scrollTop = Math.max(0, (target.scrollHeight - target.clientHeight) / 2);
      });
      await page.waitForTimeout(250);

      // Hide any transient toasts (e.g., rate-limit "Network Issue") so the
      // proof screenshots only show the brand modal we're documenting.
      await page.addStyleTag({
        content: `[data-radix-toast-viewport], [data-sonner-toaster], .Toastify, [aria-label="Notifications"] { display: none !important; }`,
      });
      await page.waitForTimeout(150);

      // Verify the proof we're about to capture actually demonstrates the
      // PremiumDialog viewport fix: the dialog title (sticky header) and the
      // Cancel/Save footer must both intersect the visible viewport.
      const proofState = await page.evaluate(`(() => {
        const dlg = document.querySelector('[role="dialog"]');
        if (!dlg) return { headerVisible: false, footerVisible: false, dialogHeight: 0 };
        const vh = window.innerHeight;
        const inView = (node) => {
          if (!node) return false;
          const r = node.getBoundingClientRect();
          return r.bottom > 0 && r.top < vh && r.height > 0;
        };
        const header = dlg.querySelector('h2, [role="heading"]');
        const firstBtn = dlg.querySelector('button[type="button"]:not([aria-label="Close"])');
        let footer = null;
        if (firstBtn) footer = firstBtn.closest('div, footer');
        if (!footer) footer = dlg.querySelector('[data-slot="dialog-footer"]');
        if (!footer) footer = dlg.querySelector('footer');
        return {
          headerVisible: inView(header),
          footerVisible: inView(footer),
          dialogHeight: dlg.getBoundingClientRect().height,
        };
      })()`) as { headerVisible: boolean; footerVisible: boolean; dialogHeight: number };
      if (!proofState.headerVisible || !proofState.footerVisible) {
        throw new Error(
          `proof invariant failed for ${theme}@${width}: ${JSON.stringify(proofState)}`
        );
      }

      const file = path.join(OUT_DIR, `brand-modal-${theme}-${width}.jpg`);
      await page.screenshot({ path: file, type: "jpeg", quality: 88, fullPage: false });
      console.log(`saved ${file}`);

      await ctx.close();
    }
  }
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
