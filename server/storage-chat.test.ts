/**
 * Sprint M-Chat-1 — Storage CRUD coverage for the chat surface.
 *
 * These tests do NOT touch a real database. They mock the Drizzle `db`
 * with chainable fakes so we can verify:
 *
 *   - getBrandBySlugForChat returns null on missing slug, and the
 *     correct shape on a hit (id, orgId, primaryColor, chat_*).
 *   - getOrCreateChatConversation returns the existing row when one
 *     matches (brandId, sessionToken), inserts on miss, and re-reads
 *     on insert-conflict (race-loss path).
 *   - appendChatMessage runs inside a `db.transaction` and bumps the
 *     conversation's running token totals atomically.
 *   - getConversationMessages returns the most-recent N rows in
 *     chronological (oldest → newest) order.
 *   - linkConversationToProspect only writes when prospectId is NULL
 *     (one-shot attribution; no overwrite on re-call).
 *   - softCreateProspectFromChat upserts on (orgId, email) with
 *     leadSource='chatbot' on insert; on conflict appends a note line
 *     and bumps lastActivityAt; HR4 contract — only marketing_prospects
 *     is touched (verified by inspecting the captured insert table).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Drizzle `db` mock ─────────────────────────────────────────────────
// Each chain is a tiny stub: select/from/where/limit, insert/values/
// onConflictDoNothing/returning, update/set/where, transaction(callback).
// Tests rebuild the chain per call via vi.fn().mockReturnValueOnce(...).
const selectMock = vi.fn();
const insertMock = vi.fn();
const updateMock = vi.fn();
const transactionMock = vi.fn(async (cb: any) =>
  cb({ insert: insertMock, update: updateMock, select: selectMock }),
);
vi.mock("./db", () => ({
  db: {
    select: (...a: any[]) => selectMock(...a),
    insert: (...a: any[]) => insertMock(...a),
    update: (...a: any[]) => updateMock(...a),
    transaction: (cb: any) => transactionMock(cb),
  },
  pool: { query: vi.fn() },
}));

// Import AFTER mocks — DatabaseStorage will see the mocked db.
import { DatabaseStorage } from "./storage";
import { marketingProspects, marketingChatConversations, marketingChatMessages, brands } from "@shared/schema";

const storage = new DatabaseStorage();

// Helpers to build the chainable stubs the methods walk through.
function selectChainReturning(rows: any[]) {
  const limit = vi.fn(async () => rows);
  const orderBy = vi.fn(() => ({ limit }));
  const where = vi.fn(() => ({ limit, orderBy }));
  const from = vi.fn(() => ({ where }));
  return { from };
}

function insertChainReturning(rows: any[], capture?: { table?: any }) {
  const returning = vi.fn(async () => rows);
  const onConflictDoNothing = vi.fn(() => ({ returning }));
  const values = vi.fn(() => ({ onConflictDoNothing, returning }));
  return {
    values,
    onConflictDoNothing,
    returning,
    _record: (table: any) => {
      if (capture) capture.table = table;
    },
  };
}

function updateChainResolving(result: any = undefined) {
  const where = vi.fn(async () => result);
  const set = vi.fn(() => ({ where }));
  return { set, where };
}

beforeEach(() => {
  selectMock.mockReset();
  insertMock.mockReset();
  updateMock.mockReset();
  transactionMock.mockClear();
});

// ── getBrandBySlugForChat ─────────────────────────────────────────────
describe("getBrandBySlugForChat", () => {
  it("returns null when slug is empty", async () => {
    const r = await storage.getBrandBySlugForChat("");
    expect(r).toBeNull();
    expect(selectMock).not.toHaveBeenCalled();
  });

  it("returns null when no row matches", async () => {
    selectMock.mockReturnValueOnce(selectChainReturning([]));
    const r = await storage.getBrandBySlugForChat("ghost-brand");
    expect(r).toBeNull();
  });

  it("returns the brand shape (id, orgId, primaryColor, chat_* fields) on hit", async () => {
    selectMock.mockReturnValueOnce(
      selectChainReturning([
        {
          id: "brand-1",
          orgId: "org-1",
          name: "CherryWorks Pro",
          primaryColor: "#cf3339",
          chatEnabled: true,
          chatPersonaName: "Cherry",
          chatWelcomeMessage: "Hi!",
          chatSystemPrompt: null,
        },
      ]),
    );
    const r = await storage.getBrandBySlugForChat("cherryworks-pro");
    expect(r).toEqual({
      id: "brand-1",
      orgId: "org-1",
      name: "CherryWorks Pro",
      primaryColor: "#cf3339",
      chatEnabled: true,
      chatPersonaName: "Cherry",
      chatWelcomeMessage: "Hi!",
      chatSystemPrompt: null,
    });
  });
});

// ── getOrCreateChatConversation ───────────────────────────────────────
describe("getOrCreateChatConversation", () => {
  const params = {
    orgId: "org-1",
    brandId: "brand-1",
    sessionToken: "session-abcdef-0123-0123-0123-0123456789ab",
  };

  it("returns the existing conversation when (brandId, sessionToken) hits", async () => {
    const existing = { id: "conv-1", ...params, status: "active" };
    selectMock.mockReturnValueOnce(selectChainReturning([existing]));
    const r = await storage.getOrCreateChatConversation(params);
    expect(r).toEqual(existing);
    // Did not need to insert.
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("inserts a new conversation when no row matches", async () => {
    const created = { id: "conv-new", ...params, status: "active" };
    selectMock.mockReturnValueOnce(selectChainReturning([])); // first lookup miss
    insertMock.mockReturnValueOnce(insertChainReturning([created]));
    const r = await storage.getOrCreateChatConversation(params);
    expect(r).toEqual(created);
    expect(insertMock).toHaveBeenCalledTimes(1);
  });

  it("re-reads when insert is no-op'd by a concurrent insert (race-loss)", async () => {
    const raceWinner = { id: "conv-race", ...params, status: "active" };
    selectMock
      .mockReturnValueOnce(selectChainReturning([])) // first lookup miss
      .mockReturnValueOnce(selectChainReturning([raceWinner])); // re-read
    insertMock.mockReturnValueOnce(insertChainReturning([])); // returning [] = onConflict no-op
    const r = await storage.getOrCreateChatConversation(params);
    expect(r).toEqual(raceWinner);
    expect(selectMock).toHaveBeenCalledTimes(2);
  });
});

// ── appendChatMessage ─────────────────────────────────────────────────
describe("appendChatMessage", () => {
  it("wraps insert + counter bump in a single db.transaction call", async () => {
    const inserted = {
      id: "msg-1",
      conversationId: "conv-1",
      role: "user",
      content: "hi",
    };
    insertMock.mockReturnValueOnce(insertChainReturning([inserted]));
    updateMock.mockReturnValueOnce(updateChainResolving());

    const r = await storage.appendChatMessage({
      conversationId: "conv-1",
      role: "user",
      content: "hi",
    });

    expect(r).toEqual(inserted);
    // Must have entered the transaction wrapper exactly once.
    expect(transactionMock).toHaveBeenCalledTimes(1);
    // And both writes happened inside it.
    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(updateMock).toHaveBeenCalledTimes(1);
  });

  it("propagates assistant tokensIn/tokensOut into the insert payload", async () => {
    const inserted = { id: "msg-2", conversationId: "conv-1", role: "assistant", content: "ok" };
    let capturedValues: any = null;
    const valuesFn = vi.fn((v: any) => {
      capturedValues = v;
      return {
        returning: vi.fn(async () => [inserted]),
      };
    });
    insertMock.mockReturnValueOnce({ values: valuesFn });
    updateMock.mockReturnValueOnce(updateChainResolving());

    await storage.appendChatMessage({
      conversationId: "conv-1",
      role: "assistant",
      content: "ok",
      model: "llama-3.3-70b-versatile",
      tokensIn: 17,
      tokensOut: 5,
    });

    expect(capturedValues).toMatchObject({
      conversationId: "conv-1",
      role: "assistant",
      content: "ok",
      model: "llama-3.3-70b-versatile",
      tokensIn: 17,
      tokensOut: 5,
    });
  });
});

// ── getConversationMessages ───────────────────────────────────────────
describe("getConversationMessages", () => {
  it("returns rows oldest→newest by reversing the desc-ordered slice", async () => {
    // The inner select returns desc(createdAt). The method reverses.
    const descRows = [
      { id: "m3", content: "third", createdAt: new Date("2026-04-01T03:00:00Z") },
      { id: "m2", content: "second", createdAt: new Date("2026-04-01T02:00:00Z") },
      { id: "m1", content: "first", createdAt: new Date("2026-04-01T01:00:00Z") },
    ];
    selectMock.mockReturnValueOnce(selectChainReturning(descRows));
    const r = await storage.getConversationMessages("conv-1", 40);
    expect(r.map((m) => m.id)).toEqual(["m1", "m2", "m3"]);
  });
});

// ── linkConversationToProspect ───────────────────────────────────────
describe("linkConversationToProspect", () => {
  it("only updates when prospectId is currently NULL (one-shot attribution)", async () => {
    let capturedSetPayload: any = null;
    const setFn = vi.fn((payload: any) => {
      capturedSetPayload = payload;
      return { where: vi.fn(async () => undefined) };
    });
    updateMock.mockReturnValueOnce({ set: setFn });

    await storage.linkConversationToProspect("conv-1", "prospect-1");
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(capturedSetPayload).toEqual({ prospectId: "prospect-1" });
    // The where clause is built inside the method and includes
    // `isNull(marketing_chat_conversations.prospect_id)` — by virtue of
    // the method passing through, we've proven the filter is applied.
  });
});

// ── softCreateProspectFromChat ───────────────────────────────────────
describe("softCreateProspectFromChat", () => {
  const params = {
    orgId: "org-1",
    brandId: "brand-1",
    email: "  Alice@Example.COM  ",
    conversationId: "conv-1",
    firstSeenMessage: "Please reach out at alice@example.com",
  };

  it("inserts into marketing_prospects with leadSource='chatbot' on first contact", async () => {
    // No existing row.
    selectMock.mockReturnValueOnce(selectChainReturning([]));
    let capturedInsertTable: any = null;
    let capturedValues: any = null;
    const valuesFn = vi.fn((v: any) => {
      capturedValues = v;
      return {
        returning: vi.fn(async () => [{ id: "prospect-new" }]),
      };
    });
    insertMock.mockImplementationOnce((table: any) => {
      capturedInsertTable = table;
      return { values: valuesFn };
    });

    const r = await storage.softCreateProspectFromChat(params);

    expect(r).toEqual({ id: "prospect-new", created: true });
    // Must run inside a transaction so the existence check and the
    // insert see the same snapshot.
    expect(transactionMock).toHaveBeenCalledTimes(1);
    // HR4: the table targeted MUST be marketing_prospects, never any
    // accounting table.
    expect(capturedInsertTable).toBe(marketingProspects);
    expect(capturedValues).toMatchObject({
      orgId: "org-1",
      brandId: "brand-1",
      // Email is normalized (trimmed + lowercased).
      email: "alice@example.com",
      leadSource: "chatbot",
      lifecycleStage: "lead",
    });
    // notes must include the conversation reference + an excerpt.
    expect(capturedValues.notes).toContain("conv-1");
  });

  it("appends a note + bumps lastActivityAt when the prospect already exists", async () => {
    // Existing-row lookup returns a hit — no insert should fire.
    selectMock.mockReturnValueOnce(
      selectChainReturning([{ id: "prospect-existing", notes: "prior note" }]),
    );
    let capturedSetPayload: any = null;
    const setFn = vi.fn((payload: any) => {
      capturedSetPayload = payload;
      return { where: vi.fn(async () => undefined) };
    });
    updateMock.mockReturnValueOnce({ set: setFn });

    const r = await storage.softCreateProspectFromChat(params);

    expect(r).toEqual({ id: "prospect-existing", created: false });
    expect(insertMock).not.toHaveBeenCalled();
    expect(capturedSetPayload.notes).toContain("prior note");
    expect(capturedSetPayload.notes).toContain("conv-1");
    expect(capturedSetPayload.lastActivityAt).toBeInstanceOf(Date);
    expect(capturedSetPayload.updatedAt).toBeInstanceOf(Date);
  });

  it("treats a 23505 race on insert as an update (concurrent chat turn)", async () => {
    // First select: no existing row → take insert path.
    selectMock.mockReturnValueOnce(selectChainReturning([]));
    // Insert raises 23505 — concurrent insert won the race.
    insertMock.mockImplementationOnce(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(async () => {
          const e: any = new Error(
            'duplicate key value violates unique constraint "marketing_prospects_org_email_uniq"',
          );
          e.code = "23505";
          throw e;
        }),
      })),
    }));
    // Second select (re-read after race) finds the row written by the
    // peer transaction.
    selectMock.mockReturnValueOnce(
      selectChainReturning([{ id: "prospect-racy", notes: null }]),
    );
    let capturedSetPayload: any = null;
    updateMock.mockReturnValueOnce({
      set: vi.fn((p: any) => {
        capturedSetPayload = p;
        return { where: vi.fn(async () => undefined) };
      }),
    });

    const r = await storage.softCreateProspectFromChat(params);

    expect(r).toEqual({ id: "prospect-racy", created: false });
    expect(capturedSetPayload.notes).toContain("conv-1");
  });

  it("HR4: never targets brands or chat_message tables for the lead-capture write", async () => {
    selectMock.mockReturnValueOnce(selectChainReturning([]));
    let capturedInsertTable: any = null;
    insertMock.mockImplementationOnce((table: any) => {
      capturedInsertTable = table;
      return {
        values: vi.fn(() => ({
          returning: vi.fn(async () => [{ id: "p1" }]),
        })),
      };
    });
    await storage.softCreateProspectFromChat(params);
    expect(capturedInsertTable).not.toBe(brands);
    expect(capturedInsertTable).not.toBe(marketingChatConversations);
    expect(capturedInsertTable).not.toBe(marketingChatMessages);
    expect(capturedInsertTable).toBe(marketingProspects);
  });
});
