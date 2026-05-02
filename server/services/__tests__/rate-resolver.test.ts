import { describe, it, expect, vi, beforeEach } from 'vitest';

let queryResults: any[] = [];

function createChain() {
  const chain: any = {
    select: () => chain,
    from: () => chain,
    where: () => chain,
    limit: () => {
      const result = queryResults.shift() ?? [];
      return Promise.resolve(result);
    },
  };
  return chain;
}

vi.mock('../../db', () => ({
  db: {
    select: (...args: any[]) => createChain().select(...args),
  },
}));

vi.mock('@shared/schema', () => {
  const col = (name: string) => ({ name });
  return {
    projectServiceMembers: {
      orgId: col('psm.orgId'),
      projectId: col('psm.projectId'),
      serviceId: col('psm.serviceId'),
      userId: col('psm.userId'),
      billRate: col('psm.billRate'),
      costRate: col('psm.costRate'),
      effectiveDate: col('psm.effectiveDate'),
      endDate: col('psm.endDate'),
    },
    projectServices: {
      orgId: col('ps.orgId'),
      projectId: col('ps.projectId'),
      serviceId: col('ps.serviceId'),
      rateOverride: col('ps.rateOverride'),
    },
    projectMembers: {
      orgId: col('pm.orgId'),
      projectId: col('pm.projectId'),
      userId: col('pm.userId'),
      hourlyRate: col('pm.hourlyRate'),
      costRateHourly: col('pm.costRateHourly'),
    },
    services: {
      orgId: col('svc.orgId'),
      id: col('svc.id'),
      defaultRate: col('svc.defaultRate'),
    },
    users: {
      orgId: col('u.orgId'),
      id: col('u.id'),
      defaultCostRateHourly: col('u.defaultCostRateHourly'),
    },
  };
});

vi.mock('drizzle-orm', () => ({
  eq: (...args: any[]) => args,
  and: (...args: any[]) => args,
  or: (...args: any[]) => args,
  isNull: (col: any) => ({ isNull: col }),
  lte: (...args: any[]) => args,
  gte: (...args: any[]) => args,
}));

import { resolveRates, type ResolveRatesParams } from '../rate-resolver';

const BASE_PARAMS: ResolveRatesParams = {
  orgId: 'org-1',
  projectId: 'proj-1',
  userId: 'user-1',
  serviceId: 'svc-1',
  date: new Date('2025-06-15'),
  billable: true,
};

describe('resolveRates', () => {
  beforeEach(() => {
    queryResults = [];
  });

  it('1. Bill tier 1 — PROJECT_SERVICE_MEMBER', async () => {
    queryResults = [
      [{ billRate: '200.00' }],
      [{ hourlyRate: '150', costRateHourly: null }],
      [{ costRate: null }],
      [{ defaultCostRateHourly: null }],
    ];
    const result = await resolveRates(BASE_PARAMS);
    expect(result.billRate).toBe(200);
    expect(result.billRateSource).toBe('PROJECT_SERVICE_MEMBER');
  });

  it('2. Bill tier 2 — PROJECT_SERVICE', async () => {
    queryResults = [
      [],
      [{ rateOverride: '175.00' }],
      [{ hourlyRate: '150', costRateHourly: null }],
      [{ costRate: null }],
      [{ defaultCostRateHourly: null }],
    ];
    const result = await resolveRates(BASE_PARAMS);
    expect(result.billRate).toBe(175);
    expect(result.billRateSource).toBe('PROJECT_SERVICE');
  });

  it('3. Bill tier 3 — PROJECT_MEMBER', async () => {
    queryResults = [
      [],
      [],
      [{ hourlyRate: '150.00', costRateHourly: null }],
      [],
      [{ defaultCostRateHourly: null }],
    ];
    const result = await resolveRates(BASE_PARAMS);
    expect(result.billRate).toBe(150);
    expect(result.billRateSource).toBe('PROJECT_MEMBER');
  });

  it('4. Bill tier 4 — SERVICE_DEFAULT', async () => {
    queryResults = [
      [],
      [],
      [],
      [{ defaultRate: '125.00' }],
      [],
      [{ defaultCostRateHourly: null }],
    ];
    const result = await resolveRates(BASE_PARAMS);
    expect(result.billRate).toBe(125);
    expect(result.billRateSource).toBe('SERVICE_DEFAULT');
  });

  it('5. Bill tier 5 — ERROR_NO_RATE', async () => {
    queryResults = [
      [],
      [],
      [],
      [],
      [],
      [{ defaultCostRateHourly: null }],
    ];
    const result = await resolveRates(BASE_PARAMS);
    expect(result.billRate).toBe(0);
    expect(result.billRateSource).toBe('ERROR_NO_RATE');
    expect(result.warnings.some(w => w.includes('No bill rate'))).toBe(true);
  });

  it('6. Non-billable short-circuits bill waterfall', async () => {
    queryResults = [
      [{ hourlyRate: '150', costRateHourly: null }],
      [{ costRate: '80' }],
    ];
    const result = await resolveRates({ ...BASE_PARAMS, billable: false });
    expect(result.billRate).toBe(0);
    expect(result.billRateSource).toBe('ERROR_NO_RATE');
    expect(result.warnings.some(w => w.includes('No bill rate'))).toBe(false);
  });

  it('7. serviceId=null skips PSM/PS/SERVICE_DEFAULT', async () => {
    queryResults = [
      [{ hourlyRate: '150.00', costRateHourly: '70' }],
    ];
    const result = await resolveRates({ ...BASE_PARAMS, serviceId: null });
    expect(result.billRate).toBe(150);
    expect(result.billRateSource).toBe('PROJECT_MEMBER');
  });

  it('8. Cost tier 1 — PROJECT_SERVICE_MEMBER', async () => {
    queryResults = [
      [{ billRate: '200' }],
      [{ hourlyRate: '150', costRateHourly: null }],
      [{ costRate: '80.00' }],
    ];
    const result = await resolveRates(BASE_PARAMS);
    expect(result.costRate).toBe(80);
    expect(result.costRateSource).toBe('PROJECT_SERVICE_MEMBER');
  });

  it('9. Cost tier 2 — PROJECT_MEMBER', async () => {
    queryResults = [
      [{ billRate: '200' }],
      [{ hourlyRate: '150', costRateHourly: '70.00' }],
      [{ costRate: null }],
    ];
    const result = await resolveRates(BASE_PARAMS);
    expect(result.costRate).toBe(70);
    expect(result.costRateSource).toBe('PROJECT_MEMBER');
  });

  it('10. Cost tier 2 with ZERO (unpaid intern)', async () => {
    queryResults = [
      [{ billRate: '200' }],
      [{ hourlyRate: '150', costRateHourly: '0' }],
      [{ costRate: null }],
    ];
    const result = await resolveRates(BASE_PARAMS);
    expect(result.costRate).toBe(0);
    expect(result.costRateSource).toBe('PROJECT_MEMBER');
  });

  it('11. Cost tier 3 — USER_DEFAULT', async () => {
    queryResults = [
      [{ billRate: '200' }],
      [{ hourlyRate: '150', costRateHourly: null }],
      [{ costRate: null }],
      [{ defaultCostRateHourly: '60.00' }],
    ];
    const result = await resolveRates(BASE_PARAMS);
    expect(result.costRate).toBe(60);
    expect(result.costRateSource).toBe('USER_DEFAULT');
  });

  it('12. Cost tier 4 — ZERO_FLAGGED', async () => {
    queryResults = [
      [{ billRate: '200' }],
      [{ hourlyRate: '150', costRateHourly: null }],
      [{ costRate: null }],
      [{ defaultCostRateHourly: null }],
    ];
    const result = await resolveRates(BASE_PARAMS);
    expect(result.costRate).toBe(0);
    expect(result.costRateSource).toBe('ZERO_FLAGGED');
    expect(result.warnings.some(w => w.includes('No cost rate'))).toBe(true);
  });

  it('13. Effective date filter — future effectiveDate skips tier 1', async () => {
    queryResults = [
      [],
      [],
      [{ hourlyRate: '150.00', costRateHourly: '70' }],
      [],
    ];
    const result = await resolveRates(BASE_PARAMS);
    expect(result.billRate).toBe(150);
    expect(result.billRateSource).toBe('PROJECT_MEMBER');
  });

  it('14. End date filter — past endDate skips tier 1', async () => {
    queryResults = [
      [],
      [],
      [{ hourlyRate: '150.00', costRateHourly: '70' }],
      [],
    ];
    const result = await resolveRates(BASE_PARAMS);
    expect(result.billRate).toBe(150);
    expect(result.billRateSource).toBe('PROJECT_MEMBER');
  });

  it('15. Both returned as numbers — string from DB converted', async () => {
    queryResults = [
      [{ billRate: '200.00' }],
      [{ hourlyRate: '150', costRateHourly: '70' }],
      [{ costRate: '80.50' }],
    ];
    const result = await resolveRates(BASE_PARAMS);
    expect(typeof result.billRate).toBe('number');
    expect(result.billRate).toBe(200);
    expect(typeof result.costRate).toBe('number');
    expect(result.costRate).toBe(80.5);
  });
});
