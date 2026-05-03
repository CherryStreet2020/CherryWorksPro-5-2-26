/**
 * Co-located helpers for the migrated `tests/e2e/` suite (Task #460).
 *
 * Each helper takes the per-test `isolatedOrg` fixture (admin user +
 * pre-built APIRequestContext + CSRF token) and either issues an
 * authenticated mutation or builds an auxiliary actor (TEAM_MEMBER,
 * UI page) bound to the same isolated tenant. The helpers exist
 * here — not in `tests/helpers/po/` — because they are scoped to
 * the legacy spec migration and not part of the public PO surface.
 */
import { expect, request as pwRequest, type APIRequestContext, type Page } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { addUserToIsolatedOrg } from "../helpers/po/isolation";
import { BASE } from "../helpers/po/auth";
import type { IsolatedOrgFixture } from "../helpers/po/fixtures";

export type Iso = IsolatedOrgFixture;

function tag(): string {
  return randomBytes(4).toString("hex");
}

export type JsonBody = Record<string, unknown> | unknown[];

export async function postJson(iso: Iso, path: string, data: JsonBody = {}) {
  return iso.request.post(path, {
    data,
    headers: { "X-CSRF-Token": iso.csrf },
  });
}

export async function patchJson(iso: Iso, path: string, data: JsonBody) {
  return iso.request.patch(path, {
    data,
    headers: { "X-CSRF-Token": iso.csrf },
  });
}

export async function delReq(iso: Iso, path: string) {
  return iso.request.delete(path, {
    headers: { "X-CSRF-Token": iso.csrf },
  });
}

export async function seedClient(iso: Iso, overrides: Record<string, unknown> = {}): Promise<any> {
  const t = tag();
  const r = await postJson(iso, "/api/clients", {
    name: `E2E Client ${t}`,
    email: `e2e-${t}@iso-test.com`,
    phone: "555-0100",
    ...overrides,
  });
  expect(r.ok(), `seedClient failed: ${r.status()} ${await r.text()}`).toBe(true);
  return r.json();
}

export async function seedProject(
  iso: Iso,
  clientId: string,
  overrides: Record<string, unknown> = {},
): Promise<any> {
  const t = tag();
  const r = await postJson(iso, "/api/projects", {
    name: `E2E Project ${t}`,
    clientId,
    description: "E2E iso project",
    ...overrides,
  });
  expect(r.ok(), `seedProject failed: ${r.status()} ${await r.text()}`).toBe(true);
  return r.json();
}

export async function addProjectMember(
  iso: Iso,
  projectId: string,
  userId: string,
  hourlyRate = 150,
): Promise<any> {
  const r = await postJson(iso, `/api/projects/${projectId}/members`, {
    userId,
    hourlyRate,
  });
  expect(r.ok(), `addProjectMember failed: ${r.status()} ${await r.text()}`).toBe(true);
  return r.json();
}

/**
 * Seed a billable time entry. The actor is the request context's
 * logged-in user (the iso admin by default). ADMIN bypasses the
 * project-membership check in `/api/time-entries`, so we don't need
 * to add admin as a member just to log time.
 */
export async function seedTimeEntry(
  iso: Iso,
  projectId: string,
  opts: { date?: string; minutes?: number; billable?: boolean; notes?: string } = {},
): Promise<any> {
  const r = await postJson(iso, "/api/time-entries", {
    projectId,
    date: opts.date ?? new Date().toISOString().slice(0, 10),
    minutes: opts.minutes ?? 60,
    billable: opts.billable ?? true,
    notes: opts.notes ?? "E2E iso entry",
  });
  expect(r.ok(), `seedTimeEntry failed: ${r.status()} ${await r.text()}`).toBe(true);
  return r.json();
}

export async function generateInvoice(iso: Iso, clientId: string): Promise<any> {
  const r = await postJson(iso, "/api/invoices/generate", {
    clientId,
    includeUnapproved: true,
  });
  expect(r.ok(), `generateInvoice failed: ${r.status()} ${await r.text()}`).toBe(true);
  return r.json();
}

/**
 * One-shot: create client + project + 1 billable time entry + generate invoice.
 * Returns { client, project, invoice }.
 */
export async function seedDraftInvoice(
  iso: Iso,
  opts: { minutes?: number; rate?: number } = {},
): Promise<{ client: any; project: any; invoice: any }> {
  const client = await seedClient(iso);
  const project = await seedProject(iso, client.id);
  // Admin must be a project member with an hourly rate, otherwise
  // resolveRates returns 0 and generated invoices total $0.
  await addProjectMember(iso, project.id, iso.userId, opts.rate ?? 150);
  await seedTimeEntry(iso, project.id, { minutes: opts.minutes ?? 120, billable: true });
  const invoice = await generateInvoice(iso, client.id);
  return { client, project, invoice };
}

export async function sendInvoice(iso: Iso, invoiceId: string): Promise<any> {
  const r = await postJson(iso, `/api/invoices/${invoiceId}/send`, {});
  expect(r.ok(), `sendInvoice failed: ${r.status()} ${await r.text()}`).toBe(true);
  return r.json();
}

/** Convenience: client + sent invoice with publicToken. */
export async function seedSentInvoice(
  iso: Iso,
  opts: { minutes?: number } = {},
): Promise<{ client: any; project: any; invoice: any; publicToken: string }> {
  const seeded = await seedDraftInvoice(iso, opts);
  const sent = await sendInvoice(iso, seeded.invoice.id);
  return {
    client: seeded.client,
    project: seeded.project,
    invoice: { ...seeded.invoice, ...sent },
    publicToken: sent.publicToken,
  };
}

/**
 * Log the given Playwright `Page` in as the iso admin via the UI.
 * Works with single-org users (no org-pick prompt).
 */
export async function loginPageAsIso(page: Page, iso: Iso): Promise<void> {
  await page.goto("/login");
  await page.waitForSelector('[data-testid="input-email"]', { timeout: 15000 });
  await page.fill('[data-testid="input-email"]', iso.email);
  await page.fill('[data-testid="input-password"]', iso.password);
  await page.click('[data-testid="button-login"]');
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => undefined);
  // Iso admins belong to a single org so the workspace picker should
  // never appear, but click through it defensively.
  const orgPick = page.locator('[data-testid^="button-org-pick-"]').first();
  try {
    await orgPick.waitFor({ state: "visible", timeout: 1500 });
    await orgPick.click();
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => undefined);
  } catch {
    /* no org picker — single-org user */
  }
}

export interface IsoTeamMember {
  user: { userId: string; email: string; password: string };
  request: APIRequestContext;
  csrf: string;
  dispose: () => Promise<void>;
}

/**
 * Mint a TEAM_MEMBER user inside the iso org and return a logged-in
 * APIRequestContext + CSRF token. Caller must `await dispose()`.
 */
export async function loginIsoTeamMember(iso: Iso): Promise<IsoTeamMember> {
  return loginIsoExtraUser(iso, "TEAM_MEMBER");
}

export async function loginIsoExtraUser(
  iso: Iso,
  role: "ADMIN" | "MANAGER" | "TEAM_MEMBER",
): Promise<IsoTeamMember> {
  const u = await addUserToIsolatedOrg(iso.orgId, role);
  const b = randomBytes(2);
  const ip = `198.51.${b[0]}.${(b[1] % 254) + 1}`;
  const ctx = await pwRequest.newContext({
    baseURL: BASE,
    extraHTTPHeaders: { "X-Forwarded-For": ip },
  });
  const r = await ctx.post(`${BASE}/api/auth/login`, {
    data: { email: u.email, password: u.password },
  });
  if (r.status() !== 200) {
    await ctx.dispose();
    throw new Error(`[iso ${role}] login failed: ${r.status()} ${await r.text()}`);
  }
  const csrfRes = await ctx.get(`${BASE}/api/csrf-token`);
  const csrf = csrfRes.headers()["x-csrf-token"] || "";
  return {
    user: u,
    request: ctx,
    csrf,
    dispose: () => ctx.dispose().catch(() => undefined) as Promise<void>,
  };
}
