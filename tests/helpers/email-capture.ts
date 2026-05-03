import { promises as fs } from "fs";
import path from "path";

/**
 * Default capture directory. Must match the value passed to the dev/test
 * server via the EMAIL_CAPTURE_DIR env var. Tests can override per-call.
 */
export const DEFAULT_CAPTURE_DIR =
  process.env.EMAIL_CAPTURE_DIR || "/tmp/cherry-e2e-emails";

export interface CapturedEmail {
  id: string;
  capturedAt: string;
  to: string;
  subject: string;
  html: string;
  text: string | null;
  cc: string[] | null;
  replyTo: string | null;
  fromName: string | null;
  fromEmail: string | null;
  /** mtime of the file on disk; used to scope to "after a moment" */
  _mtimeMs: number;
}

async function readAll(dir: string): Promise<CapturedEmail[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch (err: any) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
  const out: CapturedEmail[] = [];
  for (const name of entries) {
    if (!name.endsWith(".json")) continue;
    const full = path.join(dir, name);
    try {
      const [stat, raw] = await Promise.all([fs.stat(full), fs.readFile(full, "utf8")]);
      const parsed = JSON.parse(raw);
      out.push({ ...parsed, _mtimeMs: stat.mtimeMs });
    } catch {
      // ignore partial writes / parse races
    }
  }
  return out;
}

/**
 * Poll the capture directory until an email matching `match` lands, or
 * timeout. Use `sinceMs` to ignore captures older than a given watermark
 * (typically Date.now() taken before the action that should send the email).
 */
export async function waitForCapturedEmail(
  match: { to?: string | RegExp; subject?: string | RegExp; htmlIncludes?: string },
  opts: { dir?: string; sinceMs?: number; timeoutMs?: number; pollMs?: number } = {},
): Promise<CapturedEmail> {
  const dir = opts.dir ?? DEFAULT_CAPTURE_DIR;
  const since = opts.sinceMs ?? 0;
  const timeout = opts.timeoutMs ?? 5000;
  const poll = opts.pollMs ?? 100;
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    const all = await readAll(dir);
    const candidates = all.filter((e) => e._mtimeMs >= since - 50);
    const found = candidates.find((e) => emailMatches(e, match));
    if (found) return found;
    await new Promise((r) => setTimeout(r, poll));
  }
  const all = await readAll(dir);
  throw new Error(
    `Timed out waiting for captured email matching ${JSON.stringify(match)} after ${timeout}ms ` +
      `(${all.length} total in ${dir}, ${all.filter((e) => e._mtimeMs >= since - 50).length} since watermark)`,
  );
}

function emailMatches(
  e: CapturedEmail,
  m: { to?: string | RegExp; subject?: string | RegExp; htmlIncludes?: string },
): boolean {
  if (m.to !== undefined) {
    if (typeof m.to === "string" ? e.to !== m.to : !m.to.test(e.to)) return false;
  }
  if (m.subject !== undefined) {
    if (typeof m.subject === "string" ? e.subject !== m.subject : !m.subject.test(e.subject)) return false;
  }
  if (m.htmlIncludes !== undefined) {
    if (!e.html.includes(m.htmlIncludes)) return false;
  }
  return true;
}

export async function clearCapturedEmails(dir: string = DEFAULT_CAPTURE_DIR): Promise<void> {
  try {
    const entries = await fs.readdir(dir);
    await Promise.all(
      entries
        .filter((n) => n.endsWith(".json"))
        .map((n) => fs.unlink(path.join(dir, n)).catch(() => {})),
    );
  } catch (err: any) {
    if (err.code !== "ENOENT") throw err;
  }
}
