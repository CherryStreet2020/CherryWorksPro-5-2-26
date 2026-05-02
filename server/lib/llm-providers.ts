/**
 * Sprint M-Chat-1 — LLM provider router for the marketing chatbot.
 *
 * Single public entry point: `chatComplete({ system, messages, maxTokens })`.
 * Tries Groq Llama 3.3 70B first; on any retryable failure (HTTP 429/5xx,
 * network error, missing GROQ_API_KEY, malformed response) it transparently
 * falls back to Anthropic Claude Haiku 4.5. If both fail, throws a typed
 * `BothProvidersFailedError`.
 *
 * Direct `fetch` only — no SDKs — so the function is trivial to mock with
 * `vi.spyOn(global, "fetch")` in the route layer's provider-fallback test.
 *
 * Visitors must never see which provider answered. The route layer surfaces
 * `provider` in the persisted `marketing_chat_messages.model` column for
 * observability, never in the response body.
 */

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface ChatCompleteParams {
  /** System prompt — usually the curated knowledge file or brand override. */
  system: string;
  /** Ordered transcript. The newest user turn is always the last item. */
  messages: ChatMessage[];
  /** Hard ceiling on the assistant's reply length. Defaults to 512. */
  maxTokens?: number;
}

export interface ChatCompleteResult {
  text: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  provider: "groq" | "anthropic";
}

/**
 * Thrown only when BOTH providers refuse to answer (or the secrets for
 * both are missing). Route layer should catch and 503 with a polite
 * "Try again in a moment" rather than expose the internal failure.
 */
export class BothProvidersFailedError extends Error {
  readonly groqError: string;
  readonly anthropicError: string;
  constructor(groqError: string, anthropicError: string) {
    super(
      `Both LLM providers failed. groq=${groqError} anthropic=${anthropicError}`,
    );
    this.name = "BothProvidersFailedError";
    this.groqError = groqError;
    this.anthropicError = anthropicError;
  }
}

const GROQ_MODEL = "llama-3.3-70b-versatile";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const ANTHROPIC_MODEL = "claude-haiku-4-5";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_MAX_TOKENS = 512;

interface GroqResponse {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

interface AnthropicResponse {
  content?: Array<{ type: string; text?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

/**
 * Attempts a single Groq call. Returns the result on success, or a
 * descriptive error string on any failure (so the caller can record
 * BOTH failure messages in the BothProvidersFailedError).
 */
async function tryGroq(
  params: ChatCompleteParams,
): Promise<ChatCompleteResult | { error: string }> {
  const key = process.env.GROQ_API_KEY;
  if (!key) return { error: "missing GROQ_API_KEY" };

  let res: Response;
  try {
    res = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        max_tokens: params.maxTokens ?? DEFAULT_MAX_TOKENS,
        messages: [
          { role: "system", content: params.system },
          ...params.messages,
        ],
      }),
    });
  } catch (err) {
    return { error: `network: ${(err as Error).message}` };
  }

  // Treat 429 + 5xx as retryable. Any 4xx other than 429 is a configuration
  // problem we'd rather surface fast on Anthropic than retry on Groq.
  if (res.status === 429 || res.status >= 500) {
    return { error: `HTTP ${res.status}` };
  }
  if (!res.ok) {
    return { error: `HTTP ${res.status}` };
  }

  let body: GroqResponse;
  try {
    body = (await res.json()) as GroqResponse;
  } catch (err) {
    return { error: `parse: ${(err as Error).message}` };
  }

  const text = body.choices?.[0]?.message?.content?.trim();
  if (!text) return { error: "empty response" };

  return {
    text,
    model: GROQ_MODEL,
    tokensIn: body.usage?.prompt_tokens ?? 0,
    tokensOut: body.usage?.completion_tokens ?? 0,
    provider: "groq",
  };
}

/**
 * Attempts a single Anthropic call. Returns the result on success, or a
 * descriptive error string on failure. Anthropic's `messages` API takes
 * the system prompt as a top-level field and ONLY accepts user/assistant
 * roles in `messages` — we map any incoming `system` turns into the
 * top-level field by concatenation.
 */
async function tryAnthropic(
  params: ChatCompleteParams,
): Promise<ChatCompleteResult | { error: string }> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { error: "missing ANTHROPIC_API_KEY" };

  // Anthropic disallows `role: "system"` inside messages — strip them.
  const filtered = params.messages.filter((m) => m.role !== "system");

  let res: Response;
  try {
    res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: params.maxTokens ?? DEFAULT_MAX_TOKENS,
        system: params.system,
        messages: filtered.map((m) => ({ role: m.role, content: m.content })),
      }),
    });
  } catch (err) {
    return { error: `network: ${(err as Error).message}` };
  }

  if (!res.ok) {
    return { error: `HTTP ${res.status}` };
  }

  let body: AnthropicResponse;
  try {
    body = (await res.json()) as AnthropicResponse;
  } catch (err) {
    return { error: `parse: ${(err as Error).message}` };
  }

  const text = body.content
    ?.filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("")
    .trim();
  if (!text) return { error: "empty response" };

  return {
    text,
    model: ANTHROPIC_MODEL,
    tokensIn: body.usage?.input_tokens ?? 0,
    tokensOut: body.usage?.output_tokens ?? 0,
    provider: "anthropic",
  };
}

/**
 * Provider router. Tries Groq first; on any failure transparently falls
 * back to Anthropic. Throws BothProvidersFailedError only when both fail.
 */
export async function chatComplete(
  params: ChatCompleteParams,
): Promise<ChatCompleteResult> {
  const groqResult = await tryGroq(params);
  if ("text" in groqResult) return groqResult;

  const anthropicResult = await tryAnthropic(params);
  if ("text" in anthropicResult) return anthropicResult;

  throw new BothProvidersFailedError(groqResult.error, anthropicResult.error);
}
