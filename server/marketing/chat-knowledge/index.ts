/**
 * Sprint M-Chat-1 — curated chat knowledge files.
 *
 * Each marketing brand can override its system prompt at runtime via
 * `brands.chat_system_prompt` (set in M-Chat-2's admin UI). When that
 * column is null, the chatbot falls back to a curated `.md` file in
 * this directory selected by brand slug.
 *
 * Today only `cherryworks-pro` ships with a curated file. Future brands
 * (Cherry St Consulting, customer brands) will get their own `.md` here
 * during M-Chat-2 rollout. Until then, every brand falls back to the
 * cherryworkspro default.
 *
 * Files are read synchronously at first call and cached for the
 * lifetime of the process. Never reads the filesystem on the hot
 * path (per request).
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

// Anchor to the project root via process.cwd() instead of
// `fileURLToPath(import.meta.url)`. The latter compiles to
// `fileURLToPath(undefined)` when esbuild bundles to CJS for the
// `dist/index.cjs` deploy artifact and crashes the process at module
// load. process.cwd() resolves to the workspace root in both dev
// (`tsx server/index.ts`) and the Replit deploy runtime
// (`node dist/index.cjs`).
const KNOWLEDGE_DIR = resolve(process.cwd(), "server/marketing/chat-knowledge");

// In-memory cache keyed by filename. populated lazily on first read.
const cache = new Map<string, string>();

function loadFile(filename: string): string {
  const cached = cache.get(filename);
  if (cached !== undefined) return cached;
  const text = readFileSync(join(KNOWLEDGE_DIR, filename), "utf8");
  cache.set(filename, text);
  return text;
}

/**
 * Returns the curated default system prompt for a given brand slug.
 * Today every brand falls back to the cherryworkspro knowledge file.
 * Per-brand overrides via `brands.chat_system_prompt` are handled by
 * the route layer — this function only deals with the curated default.
 */
export function getKnowledgeForBrand(brandSlug: string): string {
  // Slug-specific files first; default to cherryworkspro for any brand
  // we haven't authored a file for yet.
  const candidates = [`${brandSlug}.md`, "cherryworkspro.md"];
  for (const filename of candidates) {
    try {
      return loadFile(filename);
    } catch {
      // File missing — try the next candidate.
    }
  }
  // Should never happen: cherryworkspro.md is checked into the repo.
  throw new Error(
    `[chat-knowledge] no knowledge file found for brand "${brandSlug}" and default cherryworkspro.md is missing`,
  );
}

/** Test-only: forget cached files so a new fixture is picked up. */
export function _resetKnowledgeCacheForTests(): void {
  cache.clear();
}
