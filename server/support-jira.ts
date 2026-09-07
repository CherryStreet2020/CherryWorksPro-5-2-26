/**
 * Pulls a Jira Service Management project through the Jira Cloud REST API
 * (Basic auth: Atlassian account email + API token) and shapes it for
 * support-import.ts. Nothing here is stored; the token lives only for the
 * duration of the request that carries it.
 */
import type { JiraExportIssue, JiraExportComment, JiraExportTransition, JiraExportAttachment } from "./support-import";

/** Flattens Atlassian Document Format to plain text. */
export function adfToText(node: any): string {
  if (!node) return "";
  if (typeof node === "string") return node;
  if (node.type === "text") return node.text || "";
  if (node.type === "hardBreak") return "\n";
  if (node.type === "mention") return node.attrs?.text || "";
  if (node.type === "emoji") return node.attrs?.text || "";
  if (node.type === "inlineCard") return node.attrs?.url || "";
  if (node.type === "media") {
    const name = node.attrs?.alt || node.attrs?.__fileName || node.attrs?.name;
    return name ? `[attachment: ${String(name).trim()}]\n` : "[attachment]\n";
  }
  if (node.type === "mediaSingle" || node.type === "mediaGroup") {
    const inner = (node.content || []).map(adfToText).join("");
    return inner || "[attachment]\n";
  }
  const inner = (node.content || []).map(adfToText).join("");
  if (["paragraph", "heading", "blockquote", "codeBlock", "listItem", "tableRow"].includes(node.type)) return inner + "\n";
  if (node.type === "tableCell" || node.type === "tableHeader") return inner + "\t";
  return inner;
}

export interface JiraConnection { baseUrl: string; email: string; apiToken: string }

/** A non-2xx from Jira: safe to surface as "Jira <status> on <path>". */
export class JiraHttpError extends Error {
  constructor(public readonly status: number, public readonly path: string) {
    super(`Jira ${status} on ${path}`);
    this.name = "JiraHttpError";
  }
}

export const MAX_ISSUES = 2000;
const MAX_PAGES = Math.ceil(MAX_ISSUES / 100);

export class JiraClient {
  private readonly base: string;
  private readonly auth: string;
  constructor(conn: JiraConnection, private readonly fetchImpl: typeof fetch = fetch) {
    this.base = conn.baseUrl.replace(/\/+$/, "");
    this.auth = "Basic " + Buffer.from(`${conn.email}:${conn.apiToken}`).toString("base64");
  }

  async get<T>(path: string): Promise<T> {
    const res = await this.fetchImpl(`${this.base}${path}`, { headers: { Accept: "application/json", Authorization: this.auth } });
    if (!res.ok) {
      // Upstream bodies can carry HTML or account details; keep them out of the thrown message.
      const text = await res.text().catch(() => "");
      console.warn(`[support-jira] ${res.status} on ${path.split("?")[0]}: ${text.slice(0, 300).replace(/\s+/g, " ")}`);
      throw new JiraHttpError(res.status, path.split("?")[0]);
    }
    return res.json() as Promise<T>;
  }

  /** Downloads an attachment's bytes (same Basic auth). */
  async getBytes(url: string, maxBytes: number): Promise<Buffer> {
    const target = new URL(url, this.base);
    if (target.origin !== new URL(this.base).origin) throw new Error("Attachment is not on the Jira site");
    const res = await this.fetchImpl(target.toString(), { headers: { Authorization: this.auth }, redirect: "follow" });
    if (!res.ok) throw new JiraHttpError(res.status, target.pathname);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxBytes) throw new Error("Attachment larger than the limit");
    return buf;
  }

  /** Verifies the credentials and returns the caller's display name. */
  async whoAmI(): Promise<{ displayName: string; emailAddress?: string }> {
    return this.get("/rest/api/3/myself");
  }

  async listIssues(projectKey: string, onPage?: (n: number) => void): Promise<any[]> {
    const fields = "summary,description,status,created,updated,resolutiondate,reporter,assignee,priority,issuetype,customfield_10010,components,attachment";
    const jql = encodeURIComponent(`project=${projectKey} ORDER BY created ASC`);
    const issues: any[] = [];
    let token: string | null = null;
    for (let i = 0; ; i++) {
      if (i >= MAX_PAGES) throw new Error(`Project has more than ${MAX_ISSUES} issues; import it in smaller projects or raise the cap`);
      const page: any = await this.get(`/rest/api/3/search/jql?jql=${jql}&maxResults=100&fields=${fields}&expand=changelog${token ? `&nextPageToken=${encodeURIComponent(token)}` : ""}`);
      issues.push(...(page.issues || []));
      onPage?.(issues.length);
      if (page.isLast || !page.nextPageToken) break;
      token = page.nextPageToken;
    }
    if (issues.length > MAX_ISSUES) throw new Error(`Project has more than ${MAX_ISSUES} issues`);
    return issues;
  }

  async listComments(issueKey: string): Promise<any[]> {
    const out: any[] = [];
    let start = 0;
    for (let i = 0; ; i++) {
      if (i >= 50) throw new Error(`${issueKey} has more than 5000 comments`);
      const page: any = await this.get(`/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment?maxResults=100&startAt=${start}`);
      out.push(...(page.comments || []));
      start += (page.comments || []).length;
      if (start >= (page.total ?? 0) || (page.comments || []).length === 0) break;
    }
    return out;
  }
}

export function shapeIssue(it: any, comments: any[]): JiraExportIssue {
  const f = it.fields || {};
  const shapedComments: JiraExportComment[] = comments.map(c => ({
    author: c.author?.displayName || null,
    email: c.author?.emailAddress || null,
    agent: c.author?.accountType === "atlassian",
    public: c.jsdPublic !== false,
    created: c.created,
    body: adfToText(c.body).trim().slice(0, 20000),
  }));
  const transitions: JiraExportTransition[] = (it.changelog?.histories || []).flatMap((h: any) =>
    (h.items || []).filter((x: any) => x.field === "status").map((x: any) => ({ from: x.fromString ?? null, to: x.toString ?? null, at: h.created, by: h.author?.displayName ?? null })),
  );
  const attachments: JiraExportAttachment[] = (f.attachment || []).map((a: any) => ({
    id: String(a.id), filename: a.filename || `attachment-${a.id}`, mimeType: a.mimeType ?? null, size: a.size ?? null, contentUrl: a.content, created: a.created ?? null,
  }));
  return {
    key: it.key,
    attachments,
    summary: f.summary || "(no subject)",
    description: adfToText(f.description).trim().slice(0, 20000) || null,
    status: f.status?.name || "",
    statusCategory: f.status?.statusCategory?.key ?? null,
    priority: f.priority?.name ?? null,
    requestType: f.customfield_10010?.requestType?.name ?? null,
    issueType: f.issuetype?.name ?? null,
    components: (f.components || []).map((c: any) => c.name),
    reporterName: f.reporter?.displayName ?? null,
    reporterEmail: f.reporter?.emailAddress ?? null,
    reporterIsAgent: f.reporter?.accountType === "atlassian",
    assigneeName: f.assignee?.displayName ?? null,
    assigneeEmail: f.assignee?.emailAddress ?? null,
    created: f.created,
    updated: f.updated ?? null,
    resolved: f.resolutiondate ?? null,
    comments: shapedComments,
    transitions,
  };
}

/** Full pull: every issue in the project with its comments and status history. */
export async function pullProject(conn: JiraConnection, projectKey: string, fetchImpl: typeof fetch = fetch): Promise<JiraExportIssue[]> {
  const client = new JiraClient(conn, fetchImpl);
  const issues = await client.listIssues(projectKey);
  const out: JiraExportIssue[] = [];
  for (const it of issues) {
    const comments = await client.listComments(it.key);
    out.push(shapeIssue(it, comments));
  }
  return out;
}
