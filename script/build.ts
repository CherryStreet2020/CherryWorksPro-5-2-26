import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";
import { rm, readFile, copyFile, writeFile, mkdir } from "fs/promises";
import { spawnSync } from "child_process";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);

function parseMigrationCheckHost(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl);
    return parsed.hostname || null;
  } catch {
    return null;
  }
}

interface MigrationReplaySummary {
  host: string;
  isLocal: boolean;
  allowDestructive: boolean;
}

let migrationReplaySummary: MigrationReplaySummary | null = null;
let migrationReplaySkipped = false;

function formatMigrationReplaySummary(s: MigrationReplaySummary): string {
  return (
    `migration replay host: ${s.host}` +
    (s.isLocal ? " (localhost)" : "") +
    ` | MIGRATION_CHECK_ALLOW_DESTRUCTIVE=${s.allowDestructive ? "1" : "0"}`
  );
}

function isTruthyEnvFlag(raw: string | undefined): boolean {
  if (raw === undefined) return false;
  const v = raw.trim().toLowerCase();
  if (v === "") return false;
  return v !== "0" && v !== "false" && v !== "no" && v !== "off";
}

function printSkipBanner() {
  const banner = [
    "",
    "############################################################################",
    "############################################################################",
    "##                                                                        ##",
    "##   !!!  MIGRATION REPLAY CHECK SKIPPED  !!!                             ##",
    "##                                                                        ##",
    "##   SKIP_MIGRATION_REPLAY_CHECK is set. This build is shipping           ##",
    "##   WITHOUT replaying migrations/*.sql against a throwaway Postgres.     ##",
    "##                                                                        ##",
    "##   This is an emergency / opt-out override. To re-enable the guard,     ##",
    "##   unset SKIP_MIGRATION_REPLAY_CHECK and set                            ##",
    "##   MIGRATION_CHECK_DATABASE_URL to a throwaway Postgres so that         ##",
    "##   scripts/check-migrations.sh can run again on every deploy.           ##",
    "##                                                                        ##",
    "############################################################################",
    "############################################################################",
    "",
  ];
  for (const line of banner) {
    console.error(line);
  }
}

function runMigrationReplayCheck() {
  console.log("running migration replay check...");
  const url = process.env.MIGRATION_CHECK_DATABASE_URL;
  const skipFlag = isTruthyEnvFlag(process.env.SKIP_MIGRATION_REPLAY_CHECK);
  // Honor the skip flag unconditionally — when an operator has opted
  // out of the replay check (typically configured at deploy time as
  // SKIP_MIGRATION_REPLAY_CHECK=1), the build must not require
  // MIGRATION_CHECK_DATABASE_URL. The banner is loud enough that the
  // skipped state is obvious in deploy logs.
  if (skipFlag) {
    printSkipBanner();
    migrationReplaySkipped = true;
    return;
  }
  if (!url) {
    console.error(
      "[build] MIGRATION_CHECK_DATABASE_URL is not set. The deploy pipeline " +
        "must point this at a throwaway Postgres so scripts/check-migrations.sh " +
        "can replay every migrations/*.sql file before shipping, or set " +
        "SKIP_MIGRATION_REPLAY_CHECK=1 to opt out. Refusing to build.",
    );
    process.exit(1);
  }
  const host = parseMigrationCheckHost(url);
  if (!host) {
    console.error(
      "[build] MIGRATION_CHECK_DATABASE_URL is not a parseable URL. Refusing to build.",
    );
    process.exit(1);
  }
  const allowDestructive = process.env.MIGRATION_CHECK_ALLOW_DESTRUCTIVE === "1";
  const isLocal = LOCAL_HOSTS.has(host.toLowerCase());
  migrationReplaySummary = { host, isLocal, allowDestructive };
  console.log(
    `[build] migration replay target host: ${host}` +
      (isLocal ? " (localhost)" : "") +
      (allowDestructive ? " [MIGRATION_CHECK_ALLOW_DESTRUCTIVE=1]" : ""),
  );
  if (!isLocal && !allowDestructive) {
    console.error(
      `[build] REFUSING to run migration replay against non-local host '${host}'. ` +
        "The replay drops the public schema on the target database. " +
        "Point MIGRATION_CHECK_DATABASE_URL at localhost/127.0.0.1, or set " +
        "MIGRATION_CHECK_ALLOW_DESTRUCTIVE=1 to opt in explicitly.",
    );
    process.exit(1);
  }
  const result = spawnSync("bash", ["scripts/check-migrations.sh"], {
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) {
    console.error("[build] failed to invoke scripts/check-migrations.sh:", result.error);
    process.exit(1);
  }
  if (typeof result.status !== "number" || result.status !== 0) {
    console.error(
      `[build] scripts/check-migrations.sh exited with status ${result.status}. ` +
        "Refusing to ship a build whose migrations failed replay.",
    );
    process.exit(result.status === null ? 1 : result.status);
  }
}

const allowlist = [
  "@google/generative-ai",
  "axios",
  "connect-pg-simple",
  "cors",
  "date-fns",
  "drizzle-orm",
  "drizzle-zod",
  "express",
  "express-rate-limit",
  "express-session",
  "jsonwebtoken",
  "memorystore",
  "multer",
  "nanoid",
  "nodemailer",
  "openai",
  "passport",
  "passport-local",
  "pg",
  "stripe",
  "uuid",
  "ws",
  "zod",
  "zod-validation-error",
];

async function buildAll() {
  runMigrationReplayCheck();

  await rm("dist", { recursive: true, force: true });

  console.log("building client...");
  await viteBuild();

  console.log("building server...");
  const pkg = JSON.parse(await readFile("package.json", "utf-8"));
  const allDeps = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
  ];
  const externals = allDeps.filter((dep) => !allowlist.includes(dep));

  await esbuild({
    entryPoints: ["server/index.ts"],
    platform: "node",
    bundle: true,
    format: "cjs",
    outfile: "dist/index.cjs",
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    minify: true,
    sourcemap: "external",
    external: externals,
  });

  await copyFile(
    "node_modules/connect-pg-simple/table.sql",
    "dist/table.sql",
  );
}

const DEPLOY_SUMMARY_PATH = "dist/deploy-summary.txt";

function buildDeploySummaryLines(): string[] {
  const lines: string[] = [];
  lines.push("==================== deploy summary ====================");
  if (migrationReplaySkipped) {
    lines.push(
      "[build] migration replay: SKIPPED via SKIP_MIGRATION_REPLAY_CHECK (emergency override)",
    );
    lines.push(
      "[build] WARNING: migrations/*.sql were NOT replayed against a throwaway Postgres for this build",
    );
  } else if (migrationReplaySummary) {
    lines.push(`[build] ${formatMigrationReplaySummary(migrationReplaySummary)}`);
    if (!migrationReplaySummary.isLocal && migrationReplaySummary.allowDestructive) {
      lines.push(
        "[build] WARNING: replay ran against a non-local host with destructive opt-in",
      );
    }
  } else {
    lines.push("[build] migration replay: (no summary captured)");
  }
  lines.push("========================================================");
  return lines;
}

async function writeDeploySummaryFile(lines: string[]) {
  try {
    await mkdir("dist", { recursive: true });
    await writeFile(DEPLOY_SUMMARY_PATH, lines.join("\n") + "\n", "utf-8");
    console.log(`[build] wrote deploy summary to ${DEPLOY_SUMMARY_PATH}`);
  } catch (err) {
    console.error(`[build] failed to write ${DEPLOY_SUMMARY_PATH}:`, err);
  }
}

async function printDeploySummary() {
  const lines = buildDeploySummaryLines();
  for (const line of lines) {
    console.log(line);
  }
  await writeDeploySummaryFile(lines);
}

buildAll().then(async () => {
  await printDeploySummary();
  console.log("build complete");
  process.exit(0);
}).catch((err) => {
  console.error(err);
  if (migrationReplaySummary) {
    console.error(`[build] ${formatMigrationReplaySummary(migrationReplaySummary)}`);
  }
  process.exit(1);
});
