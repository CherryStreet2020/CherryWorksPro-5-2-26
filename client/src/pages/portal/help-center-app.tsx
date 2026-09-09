/**
 * Help Center — the customer's support desk. Support only; never money.
 *
 * Routes (all under /help/:slug):
 *   /login             enter email → one-time link (approved-domain addresses self-register)
 *   /verify?token=…    exchange the link for a session
 *   /                  cases (member: mine · Customer Admin: everyone at the company)
 *   /cases/new         open a case
 *   /cases/:id         conversation (+ priority / close / reopen for Customer Admins)
 *   /team              Customer Admin: who can use the Help Center, invite a colleague
 */
import { useState } from "react";
import { Link, Route, Switch, useLocation, useParams } from "wouter";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PRIORITY_LABEL, hoursLabel, relativeTime, type CaseStatus, type CasePriority } from "@/lib/support-cases";
import {
  T, display, mono, STATUS_STYLE, Chip, btnPrimary, btnGhost, field, card, label, eyebrow,
  api, type Me, Shell, LoginPage, VerifyPage, Gate, relDate,
} from "./portal-shared";

const SURFACE = "help" as const;
const base = (slug: string) => `/help/${slug}`;

interface CaseRow { id: string; caseKey: string; subject: string; status: CaseStatus; priority: CasePriority; typeName: string | null; requesterName: string | null; requesterContactId: string | null; createdAt: string; updatedAt: string; mine: boolean; awaitingYou: boolean; hasNewReply: boolean; resolvedAt: string | null }
interface CaseList { cases: CaseRow[]; counts: { open: number; waitingOnYou: number; resolved: number; byPriority: Record<string, number> }; paging: { status: string; limit: number; offset: number; hasMore: boolean }; scope: "client" | "own" }
interface Attachment { id: string; filename: string; mimeType: string; size: number; isImage: boolean; url: string; createdAt: string }
interface CaseDetail { id: string; caseKey: string; subject: string; description: string | null; status: CaseStatus; priority: CasePriority; typeName: string | null; requesterName: string | null; assigneeName: string | null; createdAt: string; firstResponseAt: string | null; resolvedAt: string | null; attachments: Attachment[]; messages: { id: string; authorName: string; fromTeam: boolean; body: string; createdAt: string }[]; events: { id: string; kind: string; toValue: string | null; createdAt: string }[]; hours: { minutes: number; billableMinutes: number } | null }
interface CaseType { id: string; name: string; description: string | null }
interface TeamMember { id: string; firstName: string; lastName: string; email: string | null; portalRole: "member" | "admin"; isPrimary: boolean; createdAt: string; pending: boolean }
interface Team { contacts: TeamMember[]; approvedDomains: string[] }

const PRIORITY_COLOR: Record<CasePriority, string> = { LOW: T.muted, MEDIUM: T.text2, HIGH: T.warn, URGENT: T.accent };

// ─── First sign-in: the self-registered contact tells us their name ─────────
function NameGate({ slug, me, children }: { slug: string; me: Me; children: React.ReactNode }) {
  const qc = useQueryClient();
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const save = useMutation({
    mutationFn: () => api("PUT", `/api/portal/${slug}/me`, { firstName: first, lastName: last }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["portal-me", slug] }),
  });
  if (!me.contact.needsName) return <>{children}</>;
  return (
    <Shell surface={SURFACE} slug={slug} me={me}>
      <div style={{ maxWidth: 440, margin: "40px auto 0" }}>
        <h1 style={{ ...display, fontSize: 30, margin: "0 0 8px", lineHeight: 1.1 }}>Welcome — what should we call you?</h1>
        <p style={{ color: T.text2, margin: "0 0 22px", lineHeight: 1.6 }}>You signed in as <strong style={{ color: T.text }}>{me.contact.email}</strong>. Your name goes on the cases you open so the {me.orgName} team knows who to reply to.</p>
        <form onSubmit={e => { e.preventDefault(); if (first.trim() && last.trim()) save.mutate(); }} style={{ ...card, display: "grid", gap: 14 }}>
          <div><label htmlFor="hc-first" style={label}>First name</label><input id="hc-first" value={first} onChange={e => setFirst(e.target.value)} maxLength={80} autoFocus style={field} data-testid="portal-name-first" /></div>
          <div><label htmlFor="hc-last" style={label}>Last name</label><input id="hc-last" value={last} onChange={e => setLast(e.target.value)} maxLength={80} style={field} data-testid="portal-name-last" /></div>
          {save.isError && <p style={{ color: T.warn, fontSize: 13, margin: 0 }}>{(save.error as Error).message}</p>}
          <button type="submit" style={btnPrimary} disabled={!first.trim() || !last.trim() || save.isPending} data-testid="portal-name-save">{save.isPending ? "Saving…" : "Continue"}</button>
        </form>
      </div>
    </Shell>
  );
}

function Protected({ slug, active, children }: { slug: string; active?: "cases" | "team"; children: (me: Me) => React.ReactNode }) {
  return <Gate surface={SURFACE} slug={slug}>{me => <NameGate slug={slug} me={me}>{children(me)}</NameGate>}</Gate>;
}

// ─── Cases ────────────────────────────────────────────────────────────────
function CasesPage({ slug }: { slug: string }) {
  return <Protected slug={slug} active="cases">{me => <CasesList slug={slug} me={me} />}</Protected>;
}

function CasesList({ slug, me }: { slug: string; me: Me }) {
  const isAdmin = me.contact.portalRole === "admin";
  const [showResolved, setShowResolved] = useState(false);
  const [priority, setPriority] = useState<string>("");
  const [requester, setRequester] = useState<string>("");
  const [onlyMine, setOnlyMine] = useState(false);
  const PAGE = 100;
  const qs = new URLSearchParams();
  qs.set("status", showResolved ? "all" : "open");
  qs.set("limit", String(PAGE));
  if (priority) qs.set("priority", priority);
  if (requester) qs.set("requester", requester);
  const q = qs.toString();
  // Pages accumulate by offset until the server says there is no more — an old open case
  // is always reachable, however many newer ones sit above it.
  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery<CaseList>({
    queryKey: ["help-cases", slug, me.contact.id, me.contact.portalRole, q],
    queryFn: ({ pageParam }) => api("GET", `/api/portal/${slug}/cases?${q}&offset=${pageParam as number}`),
    initialPageParam: 0,
    getNextPageParam: (last) => (last.paging.hasMore ? last.paging.offset + last.paging.limit : undefined),
  });
  const all = data?.pages.flatMap(p => p.cases) ?? [];
  const counts = data?.pages[0]?.counts;
  const rows = all.filter(r => !onlyMine || r.mine);
  const requesters = Array.from(new Map(all.filter(r => r.requesterContactId && r.requesterName).map(r => [r.requesterContactId!, r.requesterName!])).entries());
  const chip = (on: boolean, text: string, onClick: () => void, testid: string) => (
    <button type="button" onClick={onClick} style={{ ...btnGhost, padding: "6px 12px", fontSize: 13, borderColor: on ? T.accent : T.line, color: on ? T.text : T.text2, background: on ? T.accentSoft : "transparent" }} data-testid={testid}>{text}</button>
  );
  return (
    <Shell surface={SURFACE} slug={slug} me={me} active="cases">
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap", marginBottom: 20 }}>
        <div>
          <h1 style={{ ...display, fontSize: 30, margin: 0, lineHeight: 1.1 }} data-testid="portal-title">{isAdmin ? `Support cases at ${me.client.name}` : "Your support cases"}</h1>
          <p style={{ margin: "6px 0 0", color: T.muted, fontSize: 13 }}>
            {isAdmin ? "Customer admin" : "Signed in as"} {me.contact.firstName} {me.contact.lastName}
            {counts ? ` · ${counts.open} open${counts.waitingOnYou ? ` · ${counts.waitingOnYou} waiting on ${isAdmin ? "your team" : "you"}` : ""}` : ""}
          </p>
        </div>
        <Link href={`${base(slug)}/cases/new`} style={{ ...btnPrimary, textDecoration: "none", display: "inline-block" }} data-testid="portal-new-case">New support case</Link>
      </div>

      {isAdmin && counts && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 16 }} data-testid="portal-admin-filters">
          {(["URGENT", "HIGH", "MEDIUM", "LOW"] as CasePriority[]).map(p => chip(priority === p, `${PRIORITY_LABEL[p]}${counts.byPriority[p] ? ` · ${counts.byPriority[p]}` : ""}`, () => setPriority(priority === p ? "" : p), `portal-filter-priority-${p}`))}
          {chip(onlyMine, "Mine", () => setOnlyMine(v => !v), "portal-filter-mine")}
          {requesters.length > 1 && (
            <select value={requester} onChange={e => setRequester(e.target.value)} style={{ ...field, width: "auto", padding: "6px 10px", fontSize: 13 }} aria-label="Requester" data-testid="portal-filter-requester">
              <option value="">Everyone</option>
              {requesters.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
          )}
        </div>
      )}

      {isLoading ? (
        <p style={{ color: T.muted }}>Loading…</p>
      ) : rows.length === 0 ? (
        <div style={{ ...card, textAlign: "center", padding: "40px 20px" }}>
          <p style={{ margin: 0, fontWeight: 600 }}>{showResolved ? "No cases yet" : "Nothing open right now"}</p>
          <p style={{ margin: "6px 0 0", color: T.text2, fontSize: 14 }}>When you need something, open a case and we'll get right on it.</p>
        </div>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 10 }} data-testid="portal-case-list">
          {rows.map(r => (
            <li key={r.id}>
              <Link href={`${base(slug)}/cases/${r.id}`} style={{ textDecoration: "none", color: "inherit" }}>
                <div style={{ ...card, padding: "14px 16px", display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 14, alignItems: "center", borderColor: r.awaitingYou ? T.warn : T.line }} data-testid={`portal-case-${r.caseKey}`}>
                  <span style={{ ...mono, fontSize: 12, color: T.accent, background: T.surface2, padding: "3px 8px", borderRadius: 6, whiteSpace: "nowrap" }}>{r.caseKey}</span>
                  <div style={{ minWidth: 0 }}>
                    <p style={{ margin: 0, fontWeight: 500, display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.subject}</span>
                      {r.hasNewReply && !["RESOLVED", "CLOSED"].includes(r.status) && <span title="New reply" style={{ width: 8, height: 8, borderRadius: 999, background: T.accent, display: "inline-block", flexShrink: 0 }} />}
                    </p>
                    <p style={{ margin: "3px 0 0", fontSize: 12, color: T.muted }}>
                      {isAdmin && <span style={{ color: PRIORITY_COLOR[r.priority], fontWeight: 600 }}>{PRIORITY_LABEL[r.priority]} · </span>}
                      {r.requesterName ?? ""}{r.typeName ? ` · ${r.typeName}` : ""} · updated {relativeTime(r.updatedAt)}
                    </p>
                  </div>
                  <Chip status={r.status} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <div style={{ marginTop: 16, display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button style={btnGhost} onClick={() => setShowResolved(v => !v)} data-testid="portal-toggle-resolved">{showResolved ? "Hide resolved" : `Show resolved${counts ? ` (${counts.resolved})` : ""}`}</button>
        {hasNextPage && <button style={btnGhost} onClick={() => fetchNextPage()} disabled={isFetchingNextPage} data-testid="portal-load-more">{isFetchingNextPage ? "Loading…" : "Show more"}</button>}
      </div>
    </Shell>
  );
}

// ─── New case ─────────────────────────────────────────────────────────────
function NewCasePage({ slug }: { slug: string }) {
  return <Protected slug={slug} active="cases">{me => <NewCaseForm slug={slug} me={me} />}</Protected>;
}

function NewCaseForm({ slug, me }: { slug: string; me: Me }) {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const { data: types } = useQuery<CaseType[]>({ queryKey: ["help-types", slug, me.contact.id], queryFn: () => api("GET", `/api/portal/${slug}/types`) });
  const [typeId, setTypeId] = useState<string>("");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<CasePriority>("MEDIUM");
  const create = useMutation({
    mutationFn: () => api<{ id: string; caseKey: string }>("POST", `/api/portal/${slug}/cases`, { typeId: typeId || null, subject, description, priority }),
    onSuccess: (row) => { qc.invalidateQueries({ queryKey: ["help-cases", slug, me.contact.id] }); navigate(`${base(slug)}/cases/${row.id}`); },
  });
  return (
    <Shell surface={SURFACE} slug={slug} me={me} active="cases">
      <Link href={base(slug)} style={{ color: T.muted, fontSize: 13, textDecoration: "none" }}>← Cases</Link>
      <h1 style={{ ...display, fontSize: 30, margin: "10px 0 6px" }}>What can we help with?</h1>
      <p style={{ color: T.text2, margin: "0 0 22px", lineHeight: 1.6 }}>Pick the closest match, then tell us what's happening. You'll get a case number right away.</p>
      <form onSubmit={e => { e.preventDefault(); if (subject.trim()) create.mutate(); }} style={{ display: "grid", gap: 18 }}>
        <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }} role="radiogroup" aria-label="Request type">
          {types?.map(t => {
            const on = typeId === t.id;
            return (
              <button type="button" key={t.id} role="radio" aria-checked={on} onClick={() => setTypeId(on ? "" : t.id)} style={{ ...card, textAlign: "left", cursor: "pointer", padding: 16, borderColor: on ? T.accent : T.line, background: on ? T.accentSoft : T.surface, color: T.text }} data-testid={`portal-type-${t.id}`}>
                <p style={{ margin: 0, fontWeight: 600 }}>{t.name}</p>
                {t.description && <p style={{ margin: "4px 0 0", fontSize: 13, color: T.text2, lineHeight: 1.5 }}>{t.description}</p>}
              </button>
            );
          })}
        </div>
        <div>
          <label htmlFor="portal-subject" style={label}>Subject</label>
          <input id="portal-subject" value={subject} onChange={e => setSubject(e.target.value)} maxLength={300} placeholder="One line that says what's wrong or what you need" style={field} data-testid="portal-subject" />
        </div>
        <div>
          <label htmlFor="portal-description" style={label}>Details</label>
          <textarea id="portal-description" value={description} onChange={e => setDescription(e.target.value)} rows={6} placeholder="What were you doing, what happened, and what did you expect? Screen names and record numbers help." style={{ ...field, resize: "vertical", lineHeight: 1.5 }} data-testid="portal-description" />
        </div>
        <div>
          <span style={label}>How urgent is it?</span>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }} role="radiogroup" aria-label="Urgency">
            {(["LOW", "MEDIUM", "HIGH", "URGENT"] as CasePriority[]).map(p => (
              <button type="button" key={p} role="radio" aria-checked={priority === p} onClick={() => setPriority(p)} style={{ ...btnGhost, padding: "8px 14px", borderColor: priority === p ? T.accent : T.line, color: priority === p ? T.text : T.text2, background: priority === p ? T.accentSoft : "transparent" }} data-testid={`portal-priority-${p}`}>{PRIORITY_LABEL[p]}</button>
            ))}
          </div>
        </div>
        {create.isError && <p style={{ color: T.warn, fontSize: 13, margin: 0 }}>{(create.error as Error).message}</p>}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <Link href={base(slug)} style={{ ...btnGhost, textDecoration: "none" }}>Cancel</Link>
          <button type="submit" style={btnPrimary} disabled={!subject.trim() || create.isPending} data-testid="portal-submit-case">{create.isPending ? "Opening…" : "Open case"}</button>
        </div>
      </form>
    </Shell>
  );
}

// ─── Case detail ──────────────────────────────────────────────────────────
function CasePage({ slug, id }: { slug: string; id: string }) {
  return <Protected slug={slug} active="cases">{me => <CaseView slug={slug} id={id} me={me} />}</Protected>;
}

function CaseView({ slug, id, me }: { slug: string; id: string; me: Me }) {
  const qc = useQueryClient();
  const isAdmin = me.contact.portalRole === "admin";
  const key = ["help-case", slug, me.contact.id, me.contact.portalRole, id];
  const { data: c, isLoading, isError } = useQuery<CaseDetail>({ queryKey: key, queryFn: () => api("GET", `/api/portal/${slug}/cases/${id}`), retry: false });
  const [body, setBody] = useState("");
  const refresh = () => { qc.invalidateQueries({ queryKey: key }); qc.invalidateQueries({ queryKey: ["help-cases", slug, me.contact.id] }); };
  const post = useMutation({
    mutationFn: () => api("POST", `/api/portal/${slug}/cases/${id}/messages`, { body }),
    onSuccess: () => { setBody(""); refresh(); },
  });
  const upload = useMutation({
    mutationFn: async (files: FileList) => {
      const fd = new FormData();
      Array.from(files).forEach(f => fd.append("files", f));
      const res = await fetch(`/api/portal/${slug}/cases/${id}/attachments`, { method: "POST", credentials: "include", headers: { "X-Requested-With": "cwp-portal" }, body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.message || `${res.status}`);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });
  const admin = useMutation({
    mutationFn: (patch: { priority?: CasePriority; action?: "close" | "reopen" }) => api("PATCH", `/api/portal/${slug}/cases/${id}`, patch),
    onSuccess: refresh,
  });
  if (isLoading) return <Shell surface={SURFACE} slug={slug} me={me} active="cases"><p style={{ color: T.muted }}>Loading…</p></Shell>;
  if (isError || !c) return <Shell surface={SURFACE} slug={slug} me={me} active="cases"><p>That case isn't available.</p><Link href={base(slug)} style={{ color: T.accent }}>Back to cases</Link></Shell>;
  const thread = [
    ...c.messages.map(m => ({ kind: "message" as const, at: m.createdAt, m })),
    ...c.events.filter(e => e.kind === "status" && e.toValue && ["RESOLVED", "WAITING_ON_CUSTOMER", "IN_PROGRESS", "CLOSED", "WAITING_ON_SUPPORT"].includes(e.toValue)).map(e => ({ kind: "event" as const, at: e.createdAt, e })),
  ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  const closedOrResolved = c.status === "RESOLVED" || c.status === "CLOSED";
  return (
    <Shell surface={SURFACE} slug={slug} me={me} active="cases">
      <Link href={base(slug)} style={{ color: T.muted, fontSize: 13, textDecoration: "none" }}>← Cases</Link>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", margin: "12px 0 6px" }}>
        <span style={{ ...mono, fontSize: 13, color: T.accent }} data-testid="portal-case-key">{c.caseKey}</span>
        <Chip status={c.status} />
        {c.typeName && <span style={{ fontSize: 12, color: T.muted }}>{c.typeName}</span>}
        <span style={{ fontSize: 12, color: PRIORITY_COLOR[c.priority], fontWeight: 600 }} data-testid="portal-case-priority">{PRIORITY_LABEL[c.priority]}</span>
      </div>
      <h1 style={{ ...display, fontSize: 28, margin: "0 0 6px", lineHeight: 1.15 }} data-testid="portal-case-subject">{c.subject}</h1>
      <p style={{ margin: "0 0 20px", color: T.muted, fontSize: 13 }}>
        Opened {relativeTime(c.createdAt)}{c.requesterName ? ` by ${c.requesterName}` : ""}{c.assigneeName ? ` · ${c.assigneeName} is on it` : " · waiting to be picked up"}
        {c.hours && ` · ${hoursLabel(c.hours.minutes)} logged`}
      </p>

      {isAdmin && (
        <section style={{ ...card, padding: 14, marginBottom: 16, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }} data-testid="portal-admin-actions">
          <span style={{ ...eyebrow, margin: 0 }}>Customer admin</span>
          <label style={{ fontSize: 13, color: T.text2, display: "flex", alignItems: "center", gap: 8 }}>
            Priority
            <select value={c.priority} onChange={e => admin.mutate({ priority: e.target.value as CasePriority })} disabled={admin.isPending || c.status === "CLOSED"} style={{ ...field, width: "auto", padding: "6px 10px", fontSize: 13 }} data-testid="portal-admin-priority">
              {(["LOW", "MEDIUM", "HIGH", "URGENT"] as CasePriority[]).map(p => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
            </select>
          </label>
          <span style={{ flex: 1 }} />
          {closedOrResolved ? (
            <button type="button" style={{ ...btnGhost, padding: "7px 12px", fontSize: 13 }} disabled={admin.isPending} onClick={() => admin.mutate({ action: "reopen" })} data-testid="portal-admin-reopen">Reopen</button>
          ) : (
            <button type="button" style={{ ...btnGhost, padding: "7px 12px", fontSize: 13 }} disabled={admin.isPending} onClick={() => { if (window.confirm(`Close ${c.caseKey}? The team will be told.`)) admin.mutate({ action: "close" }); }} data-testid="portal-admin-close">Close case</button>
          )}
          {admin.isError && <p style={{ color: T.warn, fontSize: 13, margin: 0, width: "100%" }}>{(admin.error as Error).message}</p>}
        </section>
      )}

      <div style={{ display: "grid", gap: 16 }}>
        {c.description && (
          <section style={card}>
            <p style={eyebrow}>{c.requesterName && !c.messages.length ? "What you told us" : "Description"}</p>
            <p style={{ margin: 0, whiteSpace: "pre-wrap", lineHeight: 1.65, color: T.text2 }}>{withInlineFiles(c.description, c.attachments)}</p>
          </section>
        )}

        <section style={card} data-testid="portal-attachments">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
            <p style={{ ...eyebrow, margin: 0 }}>Files{c.attachments.length ? ` (${c.attachments.length})` : ""}</p>
            {c.status !== "CLOSED" && (
              <label style={{ ...btnGhost, padding: "7px 12px", fontSize: 13, cursor: upload.isPending ? "wait" : "pointer" }}>
                {upload.isPending ? "Uploading…" : "Add files"}
                <input type="file" multiple style={{ display: "none" }} onChange={e => { if (e.target.files?.length) upload.mutate(e.target.files); e.currentTarget.value = ""; }} data-testid="portal-file-input" />
              </label>
            )}
          </div>
          {upload.isError && <p style={{ color: T.warn, fontSize: 13, margin: "0 0 10px" }}>{(upload.error as Error).message}</p>}
          {c.attachments.length === 0 ? (
            <p style={{ margin: 0, color: T.text2, fontSize: 14 }}>No files yet. Screenshots help us fix things faster.</p>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 10 }}>
              {c.attachments.map(a => (
                <a key={a.id} href={a.url} target="_blank" rel="noopener" style={{ textDecoration: "none", color: "inherit", background: T.surface2, border: `1px solid ${T.line}`, borderRadius: 10, overflow: "hidden" }} data-testid={`portal-attachment-${a.id}`}>
                  {a.isImage ? <img src={a.url} alt={a.filename} style={{ width: "100%", height: 110, objectFit: "cover", display: "block" }} loading="lazy" /> : <div style={{ height: 110, display: "flex", alignItems: "center", justifyContent: "center", color: T.muted, fontSize: 12 }}>{a.mimeType.split("/")[1]?.toUpperCase() || "FILE"}</div>}
                  <div style={{ padding: "6px 8px", fontSize: 11, display: "flex", justifyContent: "space-between", gap: 6 }}>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={a.filename}>{a.filename}</span>
                    <span style={{ color: T.muted, whiteSpace: "nowrap" }}>{a.size < 1048576 ? `${Math.round(a.size / 1024)} KB` : `${(a.size / 1048576).toFixed(1)} MB`}</span>
                  </div>
                </a>
              ))}
            </div>
          )}
        </section>

        <section style={card}>
          <p style={{ ...eyebrow, marginBottom: 14 }}>Conversation</p>
          {thread.length === 0 ? (
            <p style={{ margin: 0, color: T.text2, fontSize: 14 }}>We've received your case. You'll hear from us here and by email.</p>
          ) : (
            <ol style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 10 }} data-testid="portal-thread">
              {thread.map(item => item.kind === "event" ? (
                <li key={item.e.id} style={{ fontSize: 12, color: T.muted, display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ width: 6, height: 6, borderRadius: 999, background: T.line, display: "inline-block" }} />
                  {item.e.toValue ? `Marked ${STATUS_STYLE[item.e.toValue as CaseStatus]?.label.toLowerCase() ?? item.e.toValue.toLowerCase()}` : "Updated"} · {relativeTime(item.e.createdAt)}
                </li>
              ) : (
                <li key={item.m.id} style={{ ...card, padding: 14, background: item.m.fromTeam ? T.surface2 : T.accentSoft, borderColor: item.m.fromTeam ? T.line : "rgba(207,51,57,0.35)" }} data-testid={item.m.fromTeam ? "portal-message-team" : "portal-message-you"}>
                  <p style={{ margin: "0 0 6px", fontSize: 12, color: T.muted }}><strong style={{ color: T.text }}>{item.m.fromTeam ? item.m.authorName : item.m.authorName === `${me.contact.firstName} ${me.contact.lastName}`.trim() ? "You" : item.m.authorName}</strong>{item.m.fromTeam ? ` · ${me.orgName}` : ""} · {relDate(item.m.createdAt)}</p>
                  <p style={{ margin: 0, whiteSpace: "pre-wrap", lineHeight: 1.65 }}>{withInlineFiles(item.m.body, c.attachments)}</p>
                </li>
              ))}
            </ol>
          )}
          {c.status !== "CLOSED" && (
            <form onSubmit={e => { e.preventDefault(); if (body.trim()) post.mutate(); }} style={{ marginTop: 16 }}>
              <textarea value={body} onChange={e => setBody(e.target.value)} rows={4} placeholder={c.status === "RESOLVED" ? "Still having trouble? Reply here to reopen the case." : "Add details or reply to the team…"} style={{ ...field, resize: "vertical", lineHeight: 1.5 }} data-testid="portal-reply" />
              {post.isError && <p style={{ color: T.warn, fontSize: 13, margin: "8px 0 0" }}>{(post.error as Error).message}</p>}
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
                <button type="submit" style={btnPrimary} disabled={!body.trim() || post.isPending} data-testid="portal-send">{post.isPending ? "Sending…" : c.status === "RESOLVED" ? "Reply and reopen" : "Send"}</button>
              </div>
            </form>
          )}
        </section>
      </div>
    </Shell>
  );
}

/** "[attachment: name]" markers from imported mail/Jira become the file itself when it is on the case. */
function withInlineFiles(text: string, attachments: Attachment[]): React.ReactNode {
  const re = /\[attachment(?::\s*([^\]]+))?\]/g;
  if (!re.test(text)) return text;
  re.lastIndex = 0;
  const out: React.ReactNode[] = [];
  let last = 0; let i = 0; let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const name = m[1]?.trim();
    const att = name ? attachments.find(a => a.filename === name) : undefined;
    if (att && att.isImage) out.push(<a key={`a${i++}`} href={att.url} target="_blank" rel="noopener" style={{ display: "block", margin: "8px 0" }}><img src={att.url} alt={att.filename} style={{ maxHeight: 280, maxWidth: "100%", borderRadius: 8, border: `1px solid ${T.line}` }} loading="lazy" /></a>);
    else if (att) out.push(<a key={`a${i++}`} href={att.url} target="_blank" rel="noopener" style={{ color: T.accent }}>{att.filename}</a>);
    else out.push(<span key={`m${i++}`} style={{ color: T.muted, fontSize: 12 }}>[{name ? `file: ${name}` : "see files above"}]</span>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

// ─── Team (Customer Admin) ────────────────────────────────────────────────
function TeamPage({ slug }: { slug: string }) {
  return <Protected slug={slug} active="team">{me => me.contact.portalRole === "admin" ? <TeamView slug={slug} me={me} /> : <Shell surface={SURFACE} slug={slug} me={me}><p>Only a customer admin can manage the team.</p><Link href={base(slug)} style={{ color: T.accent }}>Back to cases</Link></Shell>}</Protected>;
}

function TeamView({ slug, me }: { slug: string; me: Me }) {
  const qc = useQueryClient();
  const key = ["help-team", slug, me.contact.id, me.contact.portalRole];
  const { data, isLoading } = useQuery<Team>({ queryKey: key, queryFn: () => api("GET", `/api/portal/${slug}/team`) });
  const [first, setFirst] = useState(""); const [last, setLast] = useState(""); const [email, setEmail] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const invite = useMutation({
    mutationFn: () => api<{ id: string }>("POST", `/api/portal/${slug}/team`, { firstName: first, lastName: last, email }),
    onSuccess: () => { setSent(email); setFirst(""); setLast(""); setEmail(""); qc.invalidateQueries({ queryKey: key }); },
  });
  return (
    <Shell surface={SURFACE} slug={slug} me={me} active="team">
      <h1 style={{ ...display, fontSize: 30, margin: "0 0 6px", lineHeight: 1.1 }}>Your team at {me.client.name}</h1>
      <p style={{ color: T.text2, margin: "0 0 22px", lineHeight: 1.6 }}>
        Everyone here can open and follow their own cases. Customer admins see every case for the company.
        {data?.approvedDomains.length ? <> Anyone with an <strong style={{ color: T.text }}>{data.approvedDomains.map(d => "@" + d).join(" or ")}</strong> address can sign in on their own — just share <span style={{ ...mono, fontSize: 13 }}>{typeof window !== "undefined" ? window.location.origin : ""}{base(slug)}</span>.</> : null}
      </p>
      <div style={{ display: "grid", gap: 16, gridTemplateColumns: "minmax(0, 1fr) minmax(0, 360px)" }}>
        <section style={card}>
          <p style={eyebrow}>People</p>
          {isLoading || !data ? <p style={{ color: T.muted, margin: 0 }}>Loading…</p> : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }} data-testid="portal-team-list">
              {data.contacts.map(p => (
                <li key={p.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: `1px solid ${T.line}` }} data-testid={`portal-team-${p.id}`}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <p style={{ margin: 0, fontWeight: 500 }}>{`${p.firstName} ${p.lastName}`.trim() || p.email}{p.id === me.contact.id ? <span style={{ color: T.muted, fontWeight: 400 }}> (you)</span> : null}</p>
                    <p style={{ margin: 0, fontSize: 12, color: T.muted }}>{p.email}</p>
                  </div>
                  {p.portalRole === "admin" && <span style={{ fontSize: 11, color: T.accent, background: T.accentSoft, padding: "3px 8px", borderRadius: 999, fontWeight: 600 }}>Admin</span>}
                  {p.pending && <span style={{ fontSize: 11, color: T.warn, background: T.warnSoft, padding: "3px 8px", borderRadius: 999, fontWeight: 600 }} title="Invited — hasn't signed in yet">Pending</span>}
                </li>
              ))}
            </ul>
          )}
        </section>
        <section style={card}>
          <p style={eyebrow}>Invite a colleague</p>
          <form onSubmit={e => { e.preventDefault(); if (first.trim() && last.trim() && email.trim()) invite.mutate(); }} style={{ display: "grid", gap: 10 }}>
            <input value={first} onChange={e => setFirst(e.target.value)} placeholder="First name" maxLength={80} style={field} data-testid="portal-invite-first" />
            <input value={last} onChange={e => setLast(e.target.value)} placeholder="Last name" maxLength={80} style={field} data-testid="portal-invite-last" />
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="name@company.com" style={field} data-testid="portal-invite-email" />
            {invite.isError && <p style={{ color: T.warn, fontSize: 13, margin: 0 }}>{(invite.error as Error).message}</p>}
            {sent && !invite.isError && <p style={{ color: T.good, fontSize: 13, margin: 0 }} data-testid="portal-invite-sent">Sign-in link sent to {sent}.</p>}
            <button type="submit" style={btnPrimary} disabled={invite.isPending || !first.trim() || !last.trim() || !email.trim()} data-testid="portal-invite-send">{invite.isPending ? "Sending…" : "Send sign-in link"}</button>
          </form>
          <p style={{ color: T.muted, fontSize: 12, margin: "12px 0 0", lineHeight: 1.5 }}>They'll get a one-time link and can open cases right away. To make someone an admin, ask {me.orgName}.</p>
        </section>
      </div>
    </Shell>
  );
}

// ─── Router ───────────────────────────────────────────────────────────────
export default function HelpCenterApp() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug;
  return (
    <Switch>
      <Route path="/help/:slug/login">{() => <LoginPage surface={SURFACE} slug={slug} />}</Route>
      <Route path="/help/:slug/verify">{() => <VerifyPage surface={SURFACE} slug={slug} />}</Route>
      <Route path="/help/:slug/cases/new">{() => <NewCasePage slug={slug} />}</Route>
      <Route path="/help/:slug/cases/:id">{(p) => <CasePage slug={slug} id={p.id} />}</Route>
      <Route path="/help/:slug/team">{() => <TeamPage slug={slug} />}</Route>
      <Route path="/help/:slug">{() => <CasesPage slug={slug} />}</Route>
      <Route>{() => <CasesPage slug={slug} />}</Route>
    </Switch>
  );
}
