/**
 * CSV Contact Import — Sprint 2c.
 *
 * Pure helper: validates mapped rows, dedupes by email (intra-batch + vs
 * existing DB rows), and emits a plan that the route handler executes.
 *
 * Kept free of Express / DB dependencies so it can be unit-tested with
 * plain inputs and no mocks.
 */
import { z } from "zod";
import { insertClientContactSchema } from "@shared/schema";

export const ALLOWED_IMPORT_COLUMNS = [
  "firstName",
  "lastName",
  "email",
  "phone",
  "role",
  "title",
  "companyName",
  "location",
  "linkedinUrl",
  "twitterUrl",
  "notes",
  "lifecycleStage",
  "leadStatus",
  "source",
] as const;

export type AllowedImportColumn = (typeof ALLOWED_IMPORT_COLUMNS)[number];

export type DedupeStrategy = "skip" | "update";

export const MAX_IMPORT_ROWS = 5000;

const importRowSchema = insertClientContactSchema
  .pick({
    firstName: true,
    lastName: true,
    email: true,
    phone: true,
    role: true,
    title: true,
    companyName: true,
    location: true,
    linkedinUrl: true,
    twitterUrl: true,
    notes: true,
    lifecycleStage: true,
    leadStatus: true,
    source: true,
  })
  .extend({
    firstName: z.string().min(1, "firstName is required"),
    lastName: z.string().min(1, "lastName is required"),
    email: z
      .string()
      .email("invalid email")
      .optional()
      .nullable(),
    linkedinUrl: z.string().url("invalid URL").optional().nullable(),
    twitterUrl: z.string().url("invalid URL").optional().nullable(),
  });

export type ValidatedImportRow = z.infer<typeof importRowSchema>;

export type RowPlan =
  | { action: "insert"; rowIndex: number; data: ValidatedImportRow }
  | {
      action: "update";
      rowIndex: number;
      data: ValidatedImportRow;
      emailKey: string;
    }
  | {
      action: "skip";
      rowIndex: number;
      reason: "duplicate_in_db" | "duplicate_in_batch";
      emailKey: string;
    }
  | {
      action: "error";
      rowIndex: number;
      message: string;
      row: Record<string, unknown>;
    };

export interface PlanContactImportInput {
  rows: Record<string, unknown>[];
  mapping: Record<string, string>;
  dedupeStrategy: DedupeStrategy;
  existingEmails: Set<string>;
}

export interface PlanContactImportResult {
  plans: RowPlan[];
  summary: {
    willCreate: number;
    willUpdate: number;
    willSkip: number;
    errors: number;
  };
}

function applyMapping(
  row: Record<string, unknown>,
  mapping: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [csvHeader, target] of Object.entries(mapping)) {
    if (
      !(ALLOWED_IMPORT_COLUMNS as readonly string[]).includes(target)
    ) {
      continue;
    }
    const raw = row[csvHeader];
    if (raw == null) continue;
    const trimmed = String(raw).trim();
    if (trimmed === "") continue;
    out[target] = trimmed;
  }
  return out;
}

export function planContactImport(
  input: PlanContactImportInput,
): PlanContactImportResult {
  const seenEmailsThisBatch = new Set<string>();
  const plans: RowPlan[] = [];
  let willCreate = 0;
  let willUpdate = 0;
  let willSkip = 0;
  let errors = 0;

  input.rows.forEach((row, rowIndex) => {
    const mapped = applyMapping(row, input.mapping);
    const parsed = importRowSchema.safeParse(mapped);

    if (!parsed.success) {
      const msg = parsed.error.errors
        .map((e) => `${e.path.join(".") || "row"}: ${e.message}`)
        .join("; ");
      plans.push({ action: "error", rowIndex, message: msg, row });
      errors++;
      return;
    }

    const data = parsed.data;
    const emailKey = data.email
      ? data.email.trim().toLowerCase()
      : null;

    if (emailKey && seenEmailsThisBatch.has(emailKey)) {
      plans.push({
        action: "skip",
        rowIndex,
        reason: "duplicate_in_batch",
        emailKey,
      });
      willSkip++;
      return;
    }
    if (emailKey) seenEmailsThisBatch.add(emailKey);

    if (emailKey && input.existingEmails.has(emailKey)) {
      if (input.dedupeStrategy === "skip") {
        plans.push({
          action: "skip",
          rowIndex,
          reason: "duplicate_in_db",
          emailKey,
        });
        willSkip++;
      } else {
        plans.push({ action: "update", rowIndex, data, emailKey });
        willUpdate++;
      }
      return;
    }

    plans.push({ action: "insert", rowIndex, data });
    willCreate++;
  });

  return {
    plans,
    summary: { willCreate, willUpdate, willSkip, errors },
  };
}
