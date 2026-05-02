/**
 * Sprint M-Chat-1 — provider router tests for chatComplete.
 *
 * Covers:
 *   - happy path on Groq (returns provider="groq")
 *   - Groq 5xx → falls back to Anthropic transparently
 *   - Groq 429 → falls back to Anthropic transparently
 *   - Groq network throw → falls back
 *   - Both providers fail → throws BothProvidersFailedError
 *   - missing GROQ_API_KEY → falls through to Anthropic
 *   - missing both keys → throws BothProvidersFailedError without fetch
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { chatComplete, BothProvidersFailedError } from "./llm-providers";

const GROQ_OK = {
  choices: [{ message: { content: "GROQ_REPLY" } }],
  usage: { prompt_tokens: 10, completion_tokens: 5 },
};
const ANTHROPIC_OK = {
  content: [{ type: "text", text: "ANTHROPIC_REPLY" }],
  usage: { input_tokens: 8, output_tokens: 4 },
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

let savedGroqKey: string | undefined;
let savedAnthropicKey: string | undefined;

beforeEach(() => {
  vi.restoreAllMocks();
  savedGroqKey = process.env.GROQ_API_KEY;
  savedAnthropicKey = process.env.ANTHROPIC_API_KEY;
  process.env.GROQ_API_KEY = "test-groq";
  process.env.ANTHROPIC_API_KEY = "test-anthropic";
});

afterEach(() => {
  process.env.GROQ_API_KEY = savedGroqKey;
  process.env.ANTHROPIC_API_KEY = savedAnthropicKey;
});

describe("chatComplete — happy path", () => {
  it("returns Groq's reply on first success", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(200, GROQ_OK));

    const r = await chatComplete({
      system: "system",
      messages: [{ role: "user", content: "hi" }],
    });

    expect(r.provider).toBe("groq");
    expect(r.text).toBe("GROQ_REPLY");
    expect(r.tokensIn).toBe(10);
    expect(r.tokensOut).toBe(5);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect((fetchSpy.mock.calls[0][0] as string).includes("groq.com")).toBe(
      true,
    );
  });
});

describe("chatComplete — fallback paths", () => {
  it("falls back to Anthropic on Groq HTTP 500", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(500, { error: "boom" }))
      .mockResolvedValueOnce(jsonResponse(200, ANTHROPIC_OK));

    const r = await chatComplete({
      system: "s",
      messages: [{ role: "user", content: "hi" }],
    });

    expect(r.provider).toBe("anthropic");
    expect(r.text).toBe("ANTHROPIC_REPLY");
    expect(r.tokensIn).toBe(8);
    expect(r.tokensOut).toBe(4);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(
      (fetchSpy.mock.calls[1][0] as string).includes("anthropic.com"),
    ).toBe(true);
  });

  it("falls back to Anthropic on Groq HTTP 429", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(429, { error: "rate" }))
      .mockResolvedValueOnce(jsonResponse(200, ANTHROPIC_OK));

    const r = await chatComplete({
      system: "s",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(r.provider).toBe("anthropic");
  });

  it("falls back when Groq fetch throws", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))
      .mockResolvedValueOnce(jsonResponse(200, ANTHROPIC_OK));

    const r = await chatComplete({
      system: "s",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(r.provider).toBe("anthropic");
  });

  it("falls back when GROQ_API_KEY is missing", async () => {
    delete process.env.GROQ_API_KEY;
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(200, ANTHROPIC_OK));

    const r = await chatComplete({
      system: "s",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(r.provider).toBe("anthropic");
    // We never tried Groq because the key was missing.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(
      (fetchSpy.mock.calls[0][0] as string).includes("anthropic.com"),
    ).toBe(true);
  });

  it("falls back when Groq returns empty content", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        jsonResponse(200, { choices: [{ message: { content: "" } }] }),
      )
      .mockResolvedValueOnce(jsonResponse(200, ANTHROPIC_OK));

    const r = await chatComplete({
      system: "s",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(r.provider).toBe("anthropic");
  });
});

describe("chatComplete — both fail", () => {
  it("throws BothProvidersFailedError when both providers 5xx", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(503, { error: "groq-down" }))
      .mockResolvedValueOnce(jsonResponse(503, { error: "anthropic-down" }));

    await expect(
      chatComplete({
        system: "s",
        messages: [{ role: "user", content: "hi" }],
      }),
    ).rejects.toBeInstanceOf(BothProvidersFailedError);
  });

  it("throws BothProvidersFailedError without fetching when both keys missing", async () => {
    delete process.env.GROQ_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await expect(
      chatComplete({
        system: "s",
        messages: [{ role: "user", content: "hi" }],
      }),
    ).rejects.toBeInstanceOf(BothProvidersFailedError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("anthropic message shaping", () => {
  it("strips system-role messages from the messages array (Anthropic rejects them)", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(503, { error: "force-fallback" }))
      .mockResolvedValueOnce(jsonResponse(200, ANTHROPIC_OK));

    await chatComplete({
      system: "TOP-SYSTEM",
      messages: [
        { role: "system", content: "stray-system" },
        { role: "user", content: "hi" },
      ],
    });

    const anthropicCall = fetchSpy.mock.calls[1];
    const body = JSON.parse(anthropicCall[1]?.body as string);
    expect(body.system).toBe("TOP-SYSTEM");
    expect(body.messages.every((m: any) => m.role !== "system")).toBe(true);
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].content).toBe("hi");
  });
});
