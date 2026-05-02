#!/usr/bin/env node
import { execSync, spawnSync } from "child_process";
import { createHash } from "crypto";
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  copyFileSync,
  readdirSync,
  statSync,
  existsSync,
  unlinkSync,
} from "fs";
import { join, dirname } from "path";

const PROHIBITED_TOKENS = [
  "fak" + "er",
  "lor" + "em",
  "ips" + "um",
  "dum" + "my",
  "exam" + "ple.com",
  "test" + "@test",
  "chang" + "eme",
  "passw" + "ord123",
  "qwe" + "rty",
  "as" + "df",
];
const PROHIBITED_RE = new RegExp(PROHIBITED_TOKENS.join("|"));
const ONLY_RE = /\.only\(|describe\.only|it\.only|test\.only/;
const KNOWN_GATES = [
  "lint",
  "typecheck",
  "test",
  "test:e2e",
  "e2e",
  "build",
  "check",
];
const WARNING_PATTERNS = [
  /\bwarn(ing)?\b/i,
  /^\(!\)/m,
  /⚠/,
];
const ZERO_WARNINGS_RE = /0 warn(ing)?s?\b/i;

function fatal(msg) {
  console.error("FATAL: " + msg);
  process.exit(1);
}

function sha256File(filePath) {
  const data = readFileSync(filePath);
  return createHash("sha256").update(data).digest("hex");
}

function shStrict(cmd) {
  return execSync(cmd, {
    encoding: "utf8",
    cwd: process.cwd(),
  }).trim();
}

function parseArgs() {
  const args = process.argv.slice(2);
  let runName = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--run-name" && args[i + 1]) {
      runName = args[i + 1];
      break;
    }
  }
  if (!runName) fatal("--run-name is required");
  return { runName };
}

function getGitInfo() {
  const commit = shStrict("git rev-parse HEAD");
  const branch = shStrict("git rev-parse --abbrev-ref HEAD");
  return { commit, branch };
}

function getNodeInfo() {
  return {
    node_version: shStrict("node -v"),
    npm_version: shStrict("npm -v"),
  };
}

function getAvailableScripts() {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  return Object.keys(pkg.scripts || {});
}

function getTrackedFiles() {
  return shStrict("git ls-files").split("\n").filter(Boolean);
}

function checkRepoDirty() {
  const unstaged = shStrict("git diff --name-only");
  const staged = shStrict("git diff --cached --name-only");
  const untracked = shStrict(
    "git ls-files --others --exclude-standard",
  );
  const dirty = [unstaged, staged, untracked].filter(Boolean).join("\n");
  if (dirty.length > 0) {
    fatal(
      "Repository is dirty. Commit or stash changes before bundling.\n" +
        dirty,
    );
  }
}

function hasWarning(line) {
  if (ZERO_WARNINGS_RE.test(line)) return false;
  for (const pat of WARNING_PATTERNS) {
    if (pat.test(line)) return true;
  }
  return false;
}

function runGate(name, stageDir) {
  const gatesDir = join(stageDir, "gates");
  mkdirSync(gatesDir, { recursive: true });

  const logPath = join(gatesDir, `${name.replace(/:/g, "_")}.log`);
  const start = Date.now();

  const result = spawnSync("npm", ["run", "-s", name], {
    encoding: "utf8",
    env: { ...process.env, CI: "1" },
    cwd: process.cwd(),
    stdio: ["pipe", "pipe", "pipe"],
    maxBuffer: 50 * 1024 * 1024,
  });

  const duration = Date.now() - start;
  const combined = (result.stdout || "") + "\n" + (result.stderr || "");
  writeFileSync(logPath, combined);

  let status = result.status === 0 ? "PASS" : "FAIL";

  if (status === "PASS") {
    const lines = combined.split("\n");
    for (const line of lines) {
      if (hasWarning(line)) {
        status = "FAIL";
        break;
      }
    }
  }

  return {
    name,
    status,
    exit_code: result.status,
    duration_ms: duration,
    log_path: `gates/${name.replace(/:/g, "_")}.log`,
  };
}

function scanFiles(files, regex) {
  const hits = [];
  for (const f of files) {
    const st = statSync(f);
    if (st.size > 5_000_000) continue;
    const content = readFileSync(f, "utf8");
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (regex.test(lines[i])) {
        hits.push(`${f}:${i + 1}: ${lines[i].trim().substring(0, 120)}`);
      }
    }
  }
  return { status: hits.length === 0 ? "PASS" : "FAIL", hits };
}

function copyFiles(files, stageDir) {
  const repoDir = join(stageDir, "repo");
  const fileEntries = [];

  for (const f of files) {
    const dest = join(repoDir, f);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(f, dest);
    const hash = sha256File(f);
    const bytes = statSync(f).size;
    fileEntries.push({ path: `repo/${f}`, sha256: hash, bytes });
  }
  return fileEntries;
}

function collectBundleFiles(dir, prefix = "") {
  const entries = [];
  for (const item of readdirSync(dir)) {
    const full = join(dir, item);
    const rel = prefix ? `${prefix}/${item}` : item;
    const st = statSync(full);
    if (st.isDirectory()) {
      entries.push(...collectBundleFiles(full, rel));
    } else {
      entries.push(rel);
    }
  }
  return entries;
}

function verifySha256Manifest(manifestPath, stageDir) {
  const content = readFileSync(manifestPath, "utf8");
  const lines = content.trim().split("\n");
  let passed = 0;
  let failed = 0;
  for (const line of lines) {
    const m = line.match(/^([a-f0-9]{64})\s{2}(.+)$/);
    if (!m) continue;
    const fp = join(stageDir, m[2]);
    if (!existsSync(fp)) {
      failed++;
      continue;
    }
    const h = createHash("sha256").update(readFileSync(fp)).digest("hex");
    if (h === m[1]) passed++;
    else failed++;
  }
  return { passed, failed, status: failed === 0 ? "PASS" : "FAIL" };
}

function main() {
  const { runName } = parseArgs();

  checkRepoDirty();

  const gitInfo = getGitInfo();
  const nodeInfo = getNodeInfo();
  const availableScripts = getAvailableScripts();
  const trackedFiles = getTrackedFiles();

  const now = new Date();
  const ts = now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z");

  const zipBaseName = `proof_bundle_${runName}_${ts}`;
  const stageDir = join("/tmp", `proof_stage_${Date.now()}`);
  mkdirSync(stageDir, { recursive: true });

  const statusLines = [];
  let anyFail = false;

  const gatesToRun = KNOWN_GATES.filter((g) => availableScripts.includes(g));
  const gateResults = [];

  for (const gate of gatesToRun) {
    const result = runGate(gate, stageDir);
    gateResults.push(result);
    statusLines.push(
      `STATUS: gate_${gate.replace(/:/g, "_")} ${result.status}`,
    );
    if (result.status === "FAIL") anyFail = true;
  }

  const forbiddenScan = scanFiles(trackedFiles, PROHIBITED_RE);
  statusLines.push(`STATUS: scan_forbidden_strings ${forbiddenScan.status}`);
  if (forbiddenScan.status === "FAIL") anyFail = true;

  const onlyScan = scanFiles(trackedFiles, ONLY_RE);
  statusLines.push(`STATUS: scan_no_only ${onlyScan.status}`);
  if (onlyScan.status === "FAIL") anyFail = true;

  const fileEntries = copyFiles(trackedFiles, stageDir);

  const manifest = {
    run_name: runName,
    created_at_utc: now.toISOString(),
    git: gitInfo,
    node: nodeInfo,
    gates: gateResults,
    scans: {
      forbidden_strings: forbiddenScan.status,
      forbidden_strings_hits: forbiddenScan.hits,
      only_scan: onlyScan.status,
      only_scan_hits: onlyScan.hits,
    },
    files: fileEntries,
  };

  writeFileSync(
    join(stageDir, "MANIFEST.json"),
    JSON.stringify(manifest, null, 2),
  );

  const allBundleFiles = collectBundleFiles(stageDir);

  const filesForHash = allBundleFiles.filter(
    (f) => f !== "bundle_files.sha256" && f !== "bundle_payload.sha256",
  );
  const bundleFilesLines = [];
  for (const f of filesForHash) {
    const hash = sha256File(join(stageDir, f));
    bundleFilesLines.push(`${hash}  ${f}`);
  }
  writeFileSync(
    join(stageDir, "bundle_files.sha256"),
    bundleFilesLines.join("\n") + "\n",
  );

  const payloadFiles = ["MANIFEST.json", "bundle_files.sha256"];
  const gatesDir = join(stageDir, "gates");
  if (existsSync(gatesDir)) {
    for (const g of readdirSync(gatesDir)) {
      payloadFiles.push(`gates/${g}`);
    }
  }
  const payloadLines = [];
  for (const f of payloadFiles) {
    const full = join(stageDir, f);
    if (existsSync(full)) {
      const hash = sha256File(full);
      payloadLines.push(`${hash}  ${f}`);
    }
  }
  writeFileSync(
    join(stageDir, "bundle_payload.sha256"),
    payloadLines.join("\n") + "\n",
  );

  const filesCheck = verifySha256Manifest(
    join(stageDir, "bundle_files.sha256"),
    stageDir,
  );
  statusLines.push(`STATUS: bundle_files_sha256 ${filesCheck.status}`);
  statusLines.push(
    `STATUS: verify_bundle_files_sha256 ${filesCheck.status} (${filesCheck.passed} OK, ${filesCheck.failed} FAILED)`,
  );
  if (filesCheck.status === "FAIL") anyFail = true;

  const payloadCheck = verifySha256Manifest(
    join(stageDir, "bundle_payload.sha256"),
    stageDir,
  );
  statusLines.push(`STATUS: bundle_payload_sha256 ${payloadCheck.status}`);
  statusLines.push(
    `STATUS: verify_bundle_payload_sha256 ${payloadCheck.status} (${payloadCheck.passed} OK, ${payloadCheck.failed} FAILED)`,
  );
  if (payloadCheck.status === "FAIL") anyFail = true;

  mkdirSync(gatesDir, { recursive: true });
  writeFileSync(
    join(gatesDir, "STATUS.txt"),
    statusLines.join("\n") + "\n",
  );

  const zipFileName = `${zipBaseName}.zip`;
  const zipPath = join(process.cwd(), zipFileName);

  if (existsSync(zipPath)) unlinkSync(zipPath);

  execSync(
    `cd "${stageDir}" && find . -type f | sort | zip -@ "${zipPath}" > /dev/null`,
    { encoding: "utf8" },
  );

  console.log(zipFileName);
  console.log(`COMMIT: ${gitInfo.commit}`);
  console.log(`BRANCH: ${gitInfo.branch}`);
  console.log(`RUN_NAME: ${runName}`);
  for (const sl of statusLines) {
    console.log(sl);
  }

  if (anyFail) {
    console.error(
      "\nBUNDLE CREATED WITH FAILURES — review STATUS lines above.",
    );
    process.exit(1);
  }
}

main();
