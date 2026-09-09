/** Shared labels, colours and types for Support Cases (never "tickets"). */

import type { SupportCaseIntake, SupportCaseImpact } from "@shared/schema";

export type { SupportCaseIntake, SupportCaseImpact };

export type CaseStatus = "NEW" | "WAITING_ON_SUPPORT" | "IN_PROGRESS" | "WAITING_ON_CUSTOMER" | "BLOCKED" | "RESOLVED" | "CLOSED";
export type CasePriority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";
export type CaseView = "open" | "mine" | "unassigned" | "waiting" | "blocked" | "breaching" | "resolved" | "all";

export const CASE_STATUS_ORDER: CaseStatus[] = ["NEW", "WAITING_ON_SUPPORT", "IN_PROGRESS", "WAITING_ON_CUSTOMER", "BLOCKED", "RESOLVED", "CLOSED"];
export const CASE_PRIORITY_ORDER: CasePriority[] = ["LOW", "MEDIUM", "HIGH", "URGENT"];

export const STATUS_LABEL: Record<CaseStatus, string> = {
  NEW: "New",
  WAITING_ON_SUPPORT: "Waiting on support",
  IN_PROGRESS: "In progress",
  WAITING_ON_CUSTOMER: "Waiting on customer",
  BLOCKED: "Blocked",
  RESOLVED: "Resolved",
  CLOSED: "Closed",
};

export const PRIORITY_LABEL: Record<CasePriority, string> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
  URGENT: "Urgent",
};

/** Colour pairs as [foreground, background]; semantic, separate from the accent. */
export const STATUS_COLOR: Record<CaseStatus, [string, string]> = {
  NEW: ["#1d4ed8", "rgba(29,78,216,0.12)"],
  WAITING_ON_SUPPORT: ["#b45309", "rgba(180,83,9,0.14)"],
  IN_PROGRESS: ["#15803d", "rgba(21,128,61,0.13)"],
  WAITING_ON_CUSTOMER: ["#6d28d9", "rgba(109,40,217,0.12)"],
  BLOCKED: ["#d97706", "rgba(217,119,6,0.14)"],
  RESOLVED: ["#0f766e", "rgba(15,118,110,0.13)"],
  CLOSED: ["#555b66", "rgba(85,91,102,0.14)"],
};

/** Customer's own statement of who is affected (intake.impact). */
export const IMPACT_LABEL: Record<SupportCaseImpact, string> = {
  ONE_PERSON: "One person",
  TEAM: "A team",
  COMPANY: "Whole company",
  PRODUCTION_STOPPED: "Production stopped",
};

/** Human labels for the structured intake fields, in display order. */
export const INTAKE_FIELD_LABELS: Record<keyof SupportCaseIntake, string> = {
  affectedArea: "Affected area",
  references: "References",
  impact: "Impact",
  stepsToReproduce: "Steps to reproduce",
  expected: "Expected outcome",
  startedAt: "Started on",
  neededBy: "Needed by",
  environment: "Environment",
};

export const PRIORITY_COLOR: Record<CasePriority, [string, string]> = {
  LOW: ["#555b66", "rgba(85,91,102,0.12)"],
  MEDIUM: ["#1d4ed8", "rgba(29,78,216,0.10)"],
  HIGH: ["#b45309", "rgba(180,83,9,0.14)"],
  URGENT: ["#b91c1c", "rgba(185,28,28,0.14)"],
};

export interface CaseListRow {
  id: string;
  caseKey: string;
  caseNumber: number;
  subject: string;
  status: CaseStatus;
  priority: CasePriority;
  source: string;
  clientId: string;
  clientName: string;
  projectId: string | null;
  projectName: string | null;
  typeId: string | null;
  typeName: string | null;
  requesterName: string | null;
  requesterEmail: string | null;
  assigneeUserId: string | null;
  assigneeName: string | null;
  firstResponseAt: string | null;
  lastCustomerMessageAt: string | null;
  lastAgentMessageAt: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
  minutesLogged: number;
  slaPausedAt?: string | null;
  firstResponseDueAt?: string | null;
  resolutionDueAt?: string | null;
  sla?: { firstResponse: SlaState; resolution: SlaState; nextDueAt: string | null; label: string };
}

export type SlaState = "none" | "ok" | "warning" | "breached" | "paused" | "met";

export interface CaseMessage {
  id: string;
  caseId: string;
  authorUserId: string | null;
  authorContactId: string | null;
  authorName: string;
  visibility: "CUSTOMER" | "INTERNAL";
  body: string;
  createdAt: string;
}

export interface CaseEvent {
  id: string;
  kind: string;
  fromValue: string | null;
  toValue: string | null;
  actorName: string | null;
  createdAt: string;
}

export interface CaseTimeEntry {
  id: string;
  date: string;
  minutes: number;
  billable: boolean;
  invoiced: boolean;
  notes: string | null;
  startTime: string | null;
  endTime: string | null;
  userName: string;
  projectName: string;
  serviceName: string | null;
}

export interface CaseAttachment {
  id: string;
  caseId: string;
  messageId: string | null;
  filename: string;
  mimeType: string;
  size: number;
  isImage: boolean;
  source: string;
  createdAt: string;
  url: string;
}

export function fileSizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export interface CaseWatcher {
  id: string;
  contactId: string;
  firstName: string;
  lastName: string;
  email: string | null;
  addedAt: string;
}

export interface CaseColleague {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
}

export interface CaseDetail extends CaseListRow {
  attachments: CaseAttachment[];
  intake?: SupportCaseIntake | null;
  watchers?: CaseWatcher[];
  description: string | null;
  requesterContactId: string | null;
  externalRef: string | null;
  messages: CaseMessage[];
  events: CaseEvent[];
  time: { entries: CaseTimeEntry[]; totals: { minutes: number; billableMinutes: number; unbilledMinutes: number; invoicedMinutes: number } };
}

export interface CaseType {
  id: string;
  name: string;
  description: string | null;
  defaultPriority: CasePriority;
  defaultServiceId: string | null;
  sortOrder: number;
  isActive: boolean;
}

export function hoursLabel(minutes: number): string {
  if (!minutes) return "0h";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export function relativeTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const diff = Math.max(0, now - t);
  const min = Math.round(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hrs = Math.round(min / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
