import { db } from "../db";
import { eq, and, or, isNull, lte, gte } from "drizzle-orm";
import {
  projectServiceMembers,
  projectServices,
  projectMembers,
  services,
  users,
} from "@shared/schema";

export type BillRateSource = 'PROJECT_SERVICE_MEMBER' | 'PROJECT_SERVICE' | 'PROJECT_MEMBER' | 'SERVICE_DEFAULT' | 'ERROR_NO_RATE';
export type CostRateSource = 'PROJECT_SERVICE_MEMBER' | 'PROJECT_MEMBER' | 'USER_DEFAULT' | 'DERIVED_FROM_PAY' | 'ZERO_FLAGGED';

export interface ResolveRatesParams {
  orgId: string;
  projectId: string;
  userId: string;
  serviceId: string | null;
  date: Date;
  billable: boolean;
}

export interface ResolvedRates {
  billRate: number;
  costRate: number;
  billRateSource: BillRateSource;
  costRateSource: CostRateSource;
  warnings: string[];
}

export async function resolveRates(params: ResolveRatesParams): Promise<ResolvedRates> {
  const { orgId, projectId, userId, serviceId, date, billable } = params;
  const dateStr = date.toISOString().split("T")[0];
  const warnings: string[] = [];

  let billRate = 0;
  let billRateSource: BillRateSource = 'ERROR_NO_RATE';
  let costRate = 0;
  let costRateSource: CostRateSource = 'ZERO_FLAGGED';

  if (billable && serviceId) {
    const psmRows = await db
      .select({ billRate: projectServiceMembers.billRate })
      .from(projectServiceMembers)
      .where(
        and(
          eq(projectServiceMembers.orgId, orgId),
          eq(projectServiceMembers.projectId, projectId),
          eq(projectServiceMembers.serviceId, serviceId),
          eq(projectServiceMembers.userId, userId),
          or(isNull(projectServiceMembers.effectiveDate), lte(projectServiceMembers.effectiveDate, dateStr)),
          or(isNull(projectServiceMembers.endDate), gte(projectServiceMembers.endDate, dateStr)),
        ),
      )
      .limit(1);

    if (psmRows.length > 0 && psmRows[0].billRate != null) {
      billRate = Number(psmRows[0].billRate);
      billRateSource = 'PROJECT_SERVICE_MEMBER';
    }
  }

  if (billable && billRateSource === 'ERROR_NO_RATE' && serviceId) {
    const psRows = await db
      .select({ rateOverride: projectServices.rateOverride })
      .from(projectServices)
      .where(
        and(
          eq(projectServices.orgId, orgId),
          eq(projectServices.projectId, projectId),
          eq(projectServices.serviceId, serviceId),
        ),
      )
      .limit(1);

    if (psRows.length > 0 && psRows[0].rateOverride != null) {
      billRate = Number(psRows[0].rateOverride);
      billRateSource = 'PROJECT_SERVICE';
    }
  }

  const pmRows = await db
    .select({
      hourlyRate: projectMembers.hourlyRate,
      costRateHourly: projectMembers.costRateHourly,
    })
    .from(projectMembers)
    .where(
      and(
        eq(projectMembers.orgId, orgId),
        eq(projectMembers.projectId, projectId),
        eq(projectMembers.userId, userId),
      ),
    )
    .limit(1);

  const pmRow = pmRows.length > 0 ? pmRows[0] : null;

  if (billable && billRateSource === 'ERROR_NO_RATE' && pmRow && pmRow.hourlyRate != null) {
    billRate = Number(pmRow.hourlyRate);
    billRateSource = 'PROJECT_MEMBER';
  }

  if (billable && billRateSource === 'ERROR_NO_RATE' && serviceId) {
    const svcRows = await db
      .select({ defaultRate: services.defaultRate })
      .from(services)
      .where(
        and(
          eq(services.orgId, orgId),
          eq(services.id, serviceId),
        ),
      )
      .limit(1);

    if (svcRows.length > 0 && svcRows[0].defaultRate != null) {
      billRate = Number(svcRows[0].defaultRate);
      billRateSource = 'SERVICE_DEFAULT';
    }
  }

  if (billable && billRateSource === 'ERROR_NO_RATE') {
    warnings.push("No bill rate found for project/service/user");
  }

  if (serviceId) {
    const psmCostRows = await db
      .select({ costRate: projectServiceMembers.costRate })
      .from(projectServiceMembers)
      .where(
        and(
          eq(projectServiceMembers.orgId, orgId),
          eq(projectServiceMembers.projectId, projectId),
          eq(projectServiceMembers.serviceId, serviceId),
          eq(projectServiceMembers.userId, userId),
          or(isNull(projectServiceMembers.effectiveDate), lte(projectServiceMembers.effectiveDate, dateStr)),
          or(isNull(projectServiceMembers.endDate), gte(projectServiceMembers.endDate, dateStr)),
        ),
      )
      .limit(1);

    if (psmCostRows.length > 0 && psmCostRows[0].costRate != null) {
      costRate = Number(psmCostRows[0].costRate);
      costRateSource = 'PROJECT_SERVICE_MEMBER';
    }
  }

  if (costRateSource === 'ZERO_FLAGGED' && pmRow && pmRow.costRateHourly != null) {
    costRate = Number(pmRow.costRateHourly);
    costRateSource = 'PROJECT_MEMBER';
  }

  if (costRateSource === 'ZERO_FLAGGED') {
    const userRows = await db
      .select({ defaultCostRateHourly: users.defaultCostRateHourly })
      .from(users)
      .where(
        and(
          eq(users.orgId, orgId),
          eq(users.id, userId),
        ),
      )
      .limit(1);

    if (userRows.length > 0 && userRows[0].defaultCostRateHourly != null) {
      costRate = Number(userRows[0].defaultCostRateHourly);
      costRateSource = 'USER_DEFAULT';
    }
  }

  if (costRateSource === 'ZERO_FLAGGED') {
    warnings.push("No cost rate found; defaulting to 0");
  }

  return {
    billRate,
    costRate,
    billRateSource,
    costRateSource,
    warnings,
  };
}
