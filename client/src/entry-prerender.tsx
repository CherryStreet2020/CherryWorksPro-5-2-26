/**
 * Build-time renderer for the public marketing routes (script/prerender.ts).
 * Renders the SAME <App /> the browser hydrates, so the markup matches; wouter is
 * pinned to the requested path with ssrPath. renderToPipeableStream + onAllReady
 * waits for every Suspense boundary, so the lazy() page components render fully
 * (renderToString would emit their fallbacks). Head tags are not taken from Helmet:
 * the server injects them from shared/seo-routes.ts.
 */
import { Writable } from "node:stream";
import { renderToPipeableStream } from "react-dom/server";
import { HelmetProvider } from "react-helmet-async";
import { Router } from "wouter";
import App from "./App";

const PENDING_BOUNDARY = "<!--$?-->";
const ERRORED_BOUNDARY = "<!--$!-->";

export function render(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const errors: unknown[] = [];
    const sink = new Writable({
      write(chunk, _enc, cb) { chunks.push(Buffer.from(chunk)); cb(); },
    });
    const stream = renderToPipeableStream(
      <HelmetProvider context={{}}>
        <Router ssrPath={path}>
          <App />
        </Router>
      </HelmetProvider>,
      {
        onError(err) { errors.push(err); },
        onShellError(err) { reject(err instanceof Error ? err : new Error(String(err))); },
        onAllReady() {
          stream.pipe(sink);
        },
      },
    );
    sink.on("finish", () => {
      const html = Buffer.concat(chunks).toString("utf-8");
      if (errors.length > 0) {
        reject(new Error(`${path}: ${errors.length} render error(s): ${errors.map((e) => (e instanceof Error ? e.message : String(e))).join(" | ")}`));
        return;
      }
      if (html.includes(PENDING_BOUNDARY) || html.includes(ERRORED_BOUNDARY)) {
        reject(new Error(`${path}: output contains an unresolved or errored Suspense boundary`));
        return;
      }
      if (html.includes('data-testid="lazy-fallback"')) {
        reject(new Error(`${path}: output contains the lazy fallback`));
        return;
      }
      resolve(html);
    });
    sink.on("error", reject);
  });
}
