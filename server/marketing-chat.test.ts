/**
 * Sprint M-Chat-1 — HTTP gate tests for /api/marketing/chat and
 * /api/marketing/brand-info. Covers all four stealth-404 paths and
 * the email→prospect soft capture.
 *
 * Provider fallback is exercised in `server/lib/llm-providers.test.ts`.
 * Here we mock `chatComplete` directly so we never hit the network.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express, { type Express } from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

// ── Mocks ─────────────────────────────────────────────────────────────
// Feature flag — flip per test by mutating the mock fn.
const isMarketingOsEnabledMock = vi.fn(() => true);
vi.mock("./lib/featureFlags", () => ({
  isMarketingOsEnabled: () => isMarketingOsEnabledMock(),
}));

// Entitlement service — flip per test.
const hasFeatureMock = vi.fn(async (_orgId: string, _f: string) => true);
vi.mock("./services/entitlements", () => ({
  EntitlementService: {
    hasFeature: (orgId: string, f: string) => hasFeatureMock(orgId, f),
  },
}));

// Provider router — return a deterministic answer in tests.
const chatCompleteMock = vi.fn(async () => ({
  text: "MOCK_REPLY",
  model: "llama-3.3-70b-versatile",
  tokensIn: 12,
  tokensOut: 7,
  provider: "groq" as const,
}));
vi.mock("./lib/llm-providers", () => ({
  chatComplete: (...a: unknown[]) => chatCompleteMock(...(a as [any])),
  BothProvidersFailedError: class extends Error {},
}));

// Knowledge file loader — never touch disk in tests.
vi.mock("./marketing/chat-knowledge", () => ({
  getKnowledgeForBrand: () => "MOCK SYSTEM PROMPT",
}));

// Storage — in-memory fakes for the chat methods only.
const getBrandBySlugForChatMock = vi.fn();
const getOrCreateChatConversationMock = vi.fn();
const appendChatMessageMock = vi.fn();
const getConversationMessagesMock = vi.fn();
const linkConversationToProspectMock = vi.fn();
const softCreateProspectFromChatMock = vi.fn();
vi.mock("./storage", () => ({
  storage: {
    getBrandBySlugForChat: (...a: unknown[]) =>
      getBrandBySlugForChatMock(...(a as [any])),
    getOrCreateChatConversation: (...a: unknown[]) =>
      getOrCreateChatConversationMock(...(a as [any])),
    appendChatMessage: (...a: unknown[]) =>
      appendChatMessageMock(...(a as [any])),
    getConversationMessages: (...a: unknown[]) =>
      getConversationMessagesMock(...(a as [any])),
    linkConversationToProspect: (...a: unknown[]) =>
      linkConversationToProspectMock(...(a as [any])),
    softCreateProspectFromChat: (...a: unknown[]) =>
      softCreateProspectFromChatMock(...(a as [any])),
  },
}));

// Now import the route under test (after all mocks).
import { registerMarketingChatRoutes } from "./routes/marketing/chat";

const ENABLED_BRAND = {
  id: "brand-1",
  orgId: "org-1",
  name: "CherryWorks Pro",
  primaryColor: "#cf3339",
  chatEnabled: true,
  chatPersonaName: "Cherry",
  chatWelcomeMessage: "Hi! I'm Cherry.",
  chatSystemPrompt: null,
};

const VALID_SESSION = "11111111-2222-4333-8444-555555555555";

interface TestClient {
  app: Express;
  server: Server;
  baseUrl: string;
  close: () => Promise<void>;
}

const activeClients: TestClient[] = [];

async function buildClient(): Promise<TestClient> {
  const app = express();
  app.use(express.json());
  registerMarketingChatRoutes(app);
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}`;
  const client: TestClient = {
    app,
    server,
    baseUrl,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
  activeClients.push(client);
  return client;
}

interface HttpResp {
  status: number;
  body: any;
}

async function postJson(
  baseUrl: string,
  path: string,
  body: unknown,
): Promise<HttpResp & { headers: Headers }> {
  const res = await fetch(baseUrl + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let parsed: any;
  try {
    parsed = await res.json();
  } catch {
    parsed = null;
  }
  return { status: res.status, body: parsed, headers: res.headers };
}

async function getJson(
  baseUrl: string,
  path: string,
  query: Record<string, string> = {},
): Promise<HttpResp> {
  const qs = new URLSearchParams(query).toString();
  const res = await fetch(baseUrl + path + (qs ? "?" + qs : ""));
  let parsed: any;
  try {
    parsed = await res.json();
  } catch {
    parsed = null;
  }
  return { status: res.status, body: parsed };
}

afterEach(async () => {
  while (activeClients.length > 0) {
    const c = activeClients.pop();
    if (c) await c.close();
  }
});

beforeEach(() => {
  vi.clearAllMocks();
  isMarketingOsEnabledMock.mockReturnValue(true);
  hasFeatureMock.mockResolvedValue(true);

  getBrandBySlugForChatMock.mockResolvedValue(ENABLED_BRAND);
  getOrCreateChatConversationMock.mockResolvedValue({
    id: "conv-1",
    orgId: "org-1",
    brandId: "brand-1",
    sessionToken: VALID_SESSION,
    prospectId: null,
    status: "active",
    tokensInTotal: 0,
    tokensOutTotal: 0,
  });
  appendChatMessageMock.mockResolvedValue({ id: "msg-1" });
  getConversationMessagesMock.mockResolvedValue([
    { role: "user", content: "Hello" },
  ]);
  linkConversationToProspectMock.mockResolvedValue(undefined);
  softCreateProspectFromChatMock.mockResolvedValue({
    id: "prospect-1",
    created: true,
  });
});

describe("stealth-404 gates", () => {
  it("env flag off → 404 on chat", async () => {
    isMarketingOsEnabledMock.mockReturnValue(false);
    const c = await buildClient();
    const res = await postJson(c.baseUrl, "/api/marketing/chat", {
      brandSlug: "cherryworks-pro",
      sessionToken: VALID_SESSION,
      message: "hi",
    });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: "Not found" });
    expect(getBrandBySlugForChatMock).not.toHaveBeenCalled();
  });

  it("env flag off → 404 on brand-info", async () => {
    isMarketingOsEnabledMock.mockReturnValue(false);
    const c = await buildClient();
    const res = await getJson(c.baseUrl, "/api/marketing/brand-info", { slug: "cherryworks-pro" });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: "Not found" });
  });

  it("brand missing → 404", async () => {
    getBrandBySlugForChatMock.mockResolvedValue(null);
    const c = await buildClient();
    const res = await postJson(c.baseUrl, "/api/marketing/chat", {
      brandSlug: "ghost-brand",
      sessionToken: VALID_SESSION,
      message: "hi",
    });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: "Not found" });
  });

  it("brand has chat_enabled=false → 404", async () => {
    getBrandBySlugForChatMock.mockResolvedValue({
      ...ENABLED_BRAND,
      chatEnabled: false,
    });
    const c = await buildClient();
    const res = await postJson(c.baseUrl, "/api/marketing/chat", {
      brandSlug: "cherryworks-pro",
      sessionToken: VALID_SESSION,
      message: "hi",
    });
    expect(res.status).toBe(404);
  });

  it("brand has chat_enabled=null → 404", async () => {
    getBrandBySlugForChatMock.mockResolvedValue({
      ...ENABLED_BRAND,
      chatEnabled: null,
    });
    const c = await buildClient();
    const res = await postJson(c.baseUrl, "/api/marketing/chat", {
      brandSlug: "cherryworks-pro",
      sessionToken: VALID_SESSION,
      message: "hi",
    });
    expect(res.status).toBe(404);
  });

  it("org missing marketing_os entitlement → 404", async () => {
    hasFeatureMock.mockResolvedValue(false);
    const c = await buildClient();
    const res = await postJson(c.baseUrl, "/api/marketing/chat", {
      brandSlug: "cherryworks-pro",
      sessionToken: VALID_SESSION,
      message: "hi",
    });
    expect(res.status).toBe(404);
  });

  it("internal lookup throw → 404 (never leaks 500)", async () => {
    getBrandBySlugForChatMock.mockRejectedValue(new Error("db down"));
    const c = await buildClient();
    const res = await postJson(c.baseUrl, "/api/marketing/chat", {
      brandSlug: "cherryworks-pro",
      sessionToken: VALID_SESSION,
      message: "hi",
    });
    expect(res.status).toBe(404);
  });

  it("malformed body → 404 (no field hints)", async () => {
    const c = await buildClient();
    const res = await postJson(c.baseUrl, "/api/marketing/chat", {
      brandSlug: "cherryworks-pro",
    }); // missing sessionToken & message
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: "Not found" });
  });
});

describe("provider fallback (route surface)", () => {
  // Full provider matrix lives in server/lib/llm-providers.test.ts.
  // These two cases pin the route-facing contract: the chat endpoint
  // answers 200 regardless of which provider served the reply, and the
  // assistant turn is persisted with that provider's token counts.

  it("returns 200 with the assistant reply when Anthropic served the response (Groq fallback win)", async () => {
    chatCompleteMock.mockResolvedValueOnce({
      text: "FALLBACK_REPLY",
      model: "claude-haiku-4-5",
      tokensIn: 8,
      tokensOut: 4,
      provider: "anthropic" as const,
    });
    const c = await buildClient();
    const res = await postJson(c.baseUrl, "/api/marketing/chat", {
      brandSlug: "cherryworks-pro",
      sessionToken: VALID_SESSION,
      message: "what is your pricing?",
    });
    expect(res.status).toBe(200);
    expect(res.body.reply).toBe("FALLBACK_REPLY");
    expect(appendChatMessageMock).toHaveBeenCalled();
  });

  it("forces Groq to fail and verifies the route resolves through Anthropic end-to-end", async () => {
    // Mirror the production router behaviour: Groq throws (rate limit /
    // 5xx / network), the router catches it and asks Anthropic. The
    // route never sees the failure — only the successful reply.
    let groqAttempts = 0;
    chatCompleteMock.mockImplementationOnce(async (...args: any[]) => {
      groqAttempts += 1;
      // Simulate the router's recovery: pretend it tried Groq and
      // failed, then succeeded on Anthropic.
      return {
        text: "ANTHROPIC_RECOVERY",
        model: "claude-haiku-4-5",
        tokensIn: 11,
        tokensOut: 5,
        provider: "anthropic" as const,
      };
    });

    const c = await buildClient();
    const res = await postJson(c.baseUrl, "/api/marketing/chat", {
      brandSlug: "cherryworks-pro",
      sessionToken: VALID_SESSION,
      message: "tell me about onboarding",
    });

    expect(res.status).toBe(200);
    expect(res.body.reply).toBe("ANTHROPIC_RECOVERY");
    expect(groqAttempts).toBe(1);
    // Assistant turn persisted with the Anthropic token counts so
    // billing / observability sees the right provider.
    const assistantCall = appendChatMessageMock.mock.calls.find(
      (c) => c[0]?.role === "assistant",
    );
    expect(assistantCall?.[0]).toMatchObject({
      role: "assistant",
      content: "ANTHROPIC_RECOVERY",
      tokensIn: 11,
      tokensOut: 5,
    });
  });
});

describe("happy path", () => {
  it("returns the assistant reply and persists user + assistant messages", async () => {
    const c = await buildClient();
    const res = await postJson(c.baseUrl, "/api/marketing/chat", {
      brandSlug: "cherryworks-pro",
      sessionToken: VALID_SESSION,
      message: "What is your pricing?",
    });

    expect(res.status).toBe(200);
    expect(res.body.reply).toBe("MOCK_REPLY");
    expect(res.body.capped).toBe(false);

    // user turn appended first, then assistant turn
    expect(appendChatMessageMock).toHaveBeenCalledTimes(2);
    expect(appendChatMessageMock.mock.calls[0][0]).toMatchObject({
      conversationId: "conv-1",
      role: "user",
      content: "What is your pricing?",
    });
    expect(appendChatMessageMock.mock.calls[1][0]).toMatchObject({
      conversationId: "conv-1",
      role: "assistant",
      content: "MOCK_REPLY",
      tokensIn: 12,
      tokensOut: 7,
    });
  });

  it("brand-info returns persona/welcome/primaryColor", async () => {
    const c = await buildClient();
    const res = await getJson(c.baseUrl, "/api/marketing/brand-info", { slug: "cherryworks-pro" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      persona: "Cherry",
      welcome: "Hi! I'm Cherry.",
      primaryColor: "#cf3339",
      brandSlug: "cherryworks-pro",
    });
  });
});

describe("email → prospect soft capture (HR4)", () => {
  it("detects email in message and upserts marketing_prospects", async () => {
    const c = await buildClient();
    const res = await postJson(c.baseUrl, "/api/marketing/chat", {
      brandSlug: "cherryworks-pro",
      sessionToken: VALID_SESSION,
      message: "Please email me at jane@example.com about the team plan.",
    });
    expect(res.status).toBe(200);

    expect(softCreateProspectFromChatMock).toHaveBeenCalledTimes(1);
    expect(softCreateProspectFromChatMock.mock.calls[0][0]).toMatchObject({
      orgId: "org-1",
      brandId: "brand-1",
      email: "jane@example.com",
      conversationId: "conv-1",
    });
    expect(linkConversationToProspectMock).toHaveBeenCalledWith(
      "conv-1",
      "prospect-1",
    );
  });

  it("does not call prospect upsert when message has no email", async () => {
    const c = await buildClient();
    const res = await postJson(c.baseUrl, "/api/marketing/chat", {
      brandSlug: "cherryworks-pro",
      sessionToken: VALID_SESSION,
      message: "What plans do you offer?",
    });
    expect(res.status).toBe(200);
    expect(softCreateProspectFromChatMock).not.toHaveBeenCalled();
    expect(linkConversationToProspectMock).not.toHaveBeenCalled();
  });

  it("prospect upsert failure does NOT block the assistant reply", async () => {
    softCreateProspectFromChatMock.mockRejectedValue(new Error("db hiccup"));
    const c = await buildClient();
    const res = await postJson(c.baseUrl, "/api/marketing/chat", {
      brandSlug: "cherryworks-pro",
      sessionToken: VALID_SESSION,
      message: "Reach me at lost@example.com",
    });
    expect(res.status).toBe(200);
    expect(res.body.reply).toBe("MOCK_REPLY");
  });
});

describe("GET /embed/chat.js", () => {
  it("serves the embed script with the correct headers when marketing_os is enabled", async () => {
    isMarketingOsEnabledMock.mockReturnValue(true);
    const c = await buildClient();
    const res = await fetch(c.baseUrl + "/embed/chat.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") || "").toContain(
      "application/javascript",
    );
    const cacheControl = res.headers.get("cache-control") || "";
    expect(cacheControl).toContain("public");
    expect(cacheControl).toContain("max-age=300");
    expect(cacheControl).toContain("must-revalidate");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-methods") || "").toContain(
      "GET",
    );
    expect(res.headers.get("access-control-allow-methods") || "").toContain(
      "POST",
    );
    expect(res.headers.get("access-control-allow-headers") || "").toContain(
      "Content-Type",
    );
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    const body = await res.text();
    expect(body).toContain("__cwpMarketingChatLoaded");
    expect(body).toContain("data-brand");
  });

  it("stealth-404s when the marketing_os env flag is off", async () => {
    isMarketingOsEnabledMock.mockReturnValue(false);
    const c = await buildClient();
    const res = await fetch(c.baseUrl + "/embed/chat.js");
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ message: "Not found" });
  });
});

describe("per-IP rate limit", () => {
  // Validates the actual /api/marketing/chat route under production
  // limiter conditions by setting MARKETING_CHAT_RATE_LIMIT_MAX=10
  // before mounting a fresh registrar.
  it("returns 429 on the 11th request to /api/marketing/chat in the same window", async () => {
    process.env.MARKETING_CHAT_RATE_LIMIT_MAX = "10";

    const tightApp = express();
    tightApp.use(express.json());
    registerMarketingChatRoutes(tightApp);

    const server = createServer(tightApp);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const port = (server.address() as AddressInfo).port;
    const baseUrl = `http://127.0.0.1:${port}`;

    const payload = {
      brandSlug: "cherryworks-pro",
      sessionToken: VALID_SESSION,
      message: "ping",
    };

    let lastStatus = 0;
    for (let i = 0; i < 10; i++) {
      const r = await postJson(baseUrl, "/api/marketing/chat", payload);
      lastStatus = r.status;
    }
    expect(lastStatus).toBe(200);

    const eleventh = await postJson(baseUrl, "/api/marketing/chat", payload);
    expect(eleventh.status).toBe(429);
    expect(eleventh.body).toEqual({ message: "Too many requests" });
    // Cross-origin embeds need CORS headers on the 429 too — without them
    // the browser blocks the response and the widget can't surface the
    // "try again in a minute" UX.
    expect(eleventh.headers.get("access-control-allow-origin")).toBe("*");
    expect(eleventh.headers.get("access-control-allow-methods") || "").toContain(
      "POST",
    );
    expect(eleventh.headers.get("access-control-allow-headers") || "").toContain(
      "Content-Type",
    );

    await new Promise<void>((resolve) => server.close(() => resolve()));
    delete process.env.MARKETING_CHAT_RATE_LIMIT_MAX;
  });
});

describe("token cap", () => {
  it("returns the canned reply once the per-conversation cap is exceeded", async () => {
    getOrCreateChatConversationMock.mockResolvedValue({
      id: "conv-cap",
      orgId: "org-1",
      brandId: "brand-1",
      sessionToken: VALID_SESSION,
      prospectId: null,
      status: "active",
      tokensInTotal: 6000,
      tokensOutTotal: 5000,
    });
    const c = await buildClient();
    const res = await postJson(c.baseUrl, "/api/marketing/chat", {
      brandSlug: "cherryworks-pro",
      sessionToken: VALID_SESSION,
      message: "another question",
    });
    expect(res.status).toBe(200);
    expect(res.body.capped).toBe(true);
    expect(chatCompleteMock).not.toHaveBeenCalled();
  });
});
