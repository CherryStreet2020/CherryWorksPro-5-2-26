/**
 * scripts/azure/image_floor.sh — the ACS rollback floor (PLAN r13 §5).
 * Sources the script in bash with image_has_floor_label stubbed: images whose
 * ref contains "labeled-" carry the label, everything else does not.
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "child_process";
import path from "path";

const SCRIPT = path.resolve(__dirname, "../../scripts/azure/image_floor.sh");

function run(call: string) {
  const r = spawnSync("bash", ["-c", `
    set -u
    source "$1"
    image_has_floor_label() { case "$1" in *labeled-*) return 0 ;; *) return 1 ;; esac; }
    ${call}
  `, "_", SCRIPT], { encoding: "utf8" });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

describe("assert_target_above_floor", () => {
  it("allows a labeled target", () => {
    expect(run(`assert_target_above_floor acr.io/cwp@labeled-2`).code).toBe(0);
  });

  it("refuses an unlabeled target, naming the label", () => {
    const r = run(`assert_target_above_floor acr.io/cwp@old-1`);
    expect(r.code).toBe(1);
    expect(r.out).toContain("REFUSED");
    expect(r.out).toContain("cwp.acs-enum=1");
  });
});

describe("restore_allowed", () => {
  it("allows any restore to a labeled image", () => {
    expect(run(`restore_allowed acr.io/cwp@labeled-1 acr.io/cwp@labeled-2`).code).toBe(0);
    expect(run(`restore_allowed acr.io/cwp@labeled-1 acr.io/cwp@old-9`).code).toBe(0);
  });

  it("allows an unlabeled target only when the failing image is the first labeled one", () => {
    const ok = run(`restore_allowed acr.io/cwp@old-1 acr.io/cwp@labeled-1`);
    expect(ok.code).toBe(0);
    expect(ok.out).toContain("allowed once");
    const no = run(`restore_allowed acr.io/cwp@old-1 acr.io/cwp@old-2`);
    expect(no.code).toBe(1);
    expect(no.out).toContain("REFUSED automatic restore");
  });
});

describe("image_has_floor_label (real)", () => {
  it("fails closed for an image outside the deploy repository, without calling az", () => {
    const r = spawnSync("bash", ["-c", `
      source "$1"; LOGIN=cwpacr.azurecr.io IMAGE_REPO=cwp-app
      az() { echo CALLED; return 0; }
      image_has_floor_label evil.example.com/cwp-app:latest
    `, "_", SCRIPT], { encoding: "utf8" });
    expect(r.status).toBe(1);
    expect(r.stdout).not.toContain("CALLED");
    expect(r.stderr).toContain("treated as unlabeled");
  });
});
