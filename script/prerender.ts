/**
 * Pre-render the indexable public routes after the client build (called from
 * script/build.ts). Produces dist/prerendered/<slug>.html — the client index.html
 * with the page's markup in #root and the head tags from server/seo-meta.ts — for
 * every path in sitemapPaths(). Lives OUTSIDE dist/public so express.static cannot
 * serve the files directly. Any route that fails to render fails the build.
 */
import path from "node:path";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { build as viteBuild } from "vite";
import { sitemapPaths } from "../shared/seo-routes";
import { getMetaTagsForPath } from "../server/seo-meta";

const ROOT = path.resolve(import.meta.dirname, "..");

export function slugFor(routePath: string): string {
  return routePath === "/" ? "index" : routePath.replace(/^\//, "").replace(/\//g, "_");
}

export function composeDocument(template: string, bodyHtml: string, routePath: string): string {
  const withHead = template.replace("</head>", `    ${getMetaTagsForPath(routePath)}\n  </head>`);
  const marker = '<div id="root"></div>';
  if (!withHead.includes(marker)) throw new Error("index.html has no empty #root to fill");
  return withHead.replace(marker, `<div id="root">${bodyHtml}</div>`);
}

export async function prerenderAll(): Promise<void> {
  const ssrOut = path.resolve(ROOT, "dist/prerender");
  const outDir = path.resolve(ROOT, "dist/prerendered");
  await viteBuild({
    configFile: path.resolve(ROOT, "vite.config.ts"),
    logLevel: "warn",
    build: {
      ssr: path.resolve(ROOT, "client/src/entry-prerender.tsx"),
      outDir: ssrOut,
      emptyOutDir: true,
      rollupOptions: { output: { entryFileNames: "entry-prerender.js" } },
    },
  });
  const entry = path.join(ssrOut, "entry-prerender.js");
  if (!existsSync(entry)) throw new Error(`prerender: Vite SSR build did not emit ${entry}`);
  const { render } = (await import(pathToFileURL(entry).href)) as { render: (p: string) => Promise<string> };

  const template = await readFile(path.resolve(ROOT, "dist/public/index.html"), "utf-8");
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  // Fixture builds (VITE_E2E_FIXTURES=true, never the deploy build) also pre-render the
  // mismatch fixture so e2e/prerender.spec.ts can prove the hydration gate fails.
  const fixtures = process.env.VITE_E2E_FIXTURES === "true" ? ["/__hydration_mismatch"] : [];
  const rows: string[] = [];
  const manifest: Record<string, string> = {};
  for (const routePath of [...sitemapPaths(), ...fixtures]) {
    const body = await render(routePath);
    const h1s = body.match(/<h1\b/g)?.length ?? 0;
    if (h1s !== 1 && !fixtures.includes(routePath)) throw new Error(`prerender: ${routePath} has ${h1s} <h1> elements (expected 1)`);
    const doc = composeDocument(template, body, routePath);
    const file = `${slugFor(routePath)}.html`;
    await writeFile(path.join(outDir, file), doc);
    manifest[routePath] = file;
    const h1 = body.match(/<h1\b[^>]*>(.*?)<\/h1>/s)?.[1].replace(/<[^>]+>/g, "").trim().slice(0, 60) ?? "";
    rows.push(`${routePath.padEnd(26)} ${String(body.length).padStart(7)} B  ${h1}`);
  }
  // The manifest is the only source of the path → file mapping (slugs are not reversible).
  await writeFile(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(`[prerender] ${rows.length} route(s) → ${outDir}\n  ${rows.join("\n  ")}`);
}
