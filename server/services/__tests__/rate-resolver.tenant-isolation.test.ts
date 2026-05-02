import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../../db';
import { eq } from 'drizzle-orm';
import {
  orgs,
  users,
  clients,
  projects,
  services,
  projectServiceMembers,
} from '@shared/schema';
import { resolveRates } from '../rate-resolver';

const ts = Date.now();
const ORG_A_ID = `test-org-a-${ts}`;
const ORG_B_ID = `test-org-b-${ts}`;
const USER_A_ID = `test-user-a-${ts}`;
const USER_B_ID = `test-user-b-${ts}`;
const CLIENT_A_ID = `test-client-a-${ts}`;
const CLIENT_B_ID = `test-client-b-${ts}`;
const PROJECT_A_ID = `test-proj-a-${ts}`;
const PROJECT_B_ID = `test-proj-b-${ts}`;
const SERVICE_A_ID = `test-svc-a-${ts}`;
const SERVICE_B_ID = `test-svc-b-${ts}`;
const PSM_B_ID = `test-psm-b-${ts}`;

describe('resolveRates — tenant isolation', () => {
  beforeAll(async () => {
    await db.insert(orgs).values([
      { id: ORG_A_ID, name: 'Test Org A', slug: `test-org-a-${ts}` },
      { id: ORG_B_ID, name: 'Test Org B', slug: `test-org-b-${ts}` },
    ]);

    await db.insert(users).values([
      { id: USER_A_ID, orgId: ORG_A_ID, email: `user-a-${ts}@test.com`, password: 'hashed', name: 'User A' },
      { id: USER_B_ID, orgId: ORG_B_ID, email: `user-b-${ts}@test.com`, password: 'hashed', name: 'User B' },
    ]);

    await db.insert(clients).values([
      { id: CLIENT_A_ID, orgId: ORG_A_ID, name: 'Client A' },
      { id: CLIENT_B_ID, orgId: ORG_B_ID, name: 'Client B' },
    ]);

    await db.insert(projects).values([
      { id: PROJECT_A_ID, orgId: ORG_A_ID, clientId: CLIENT_A_ID, name: 'Project A' },
      { id: PROJECT_B_ID, orgId: ORG_B_ID, clientId: CLIENT_B_ID, name: 'Project B' },
    ]);

    await db.insert(services).values([
      { id: SERVICE_A_ID, orgId: ORG_A_ID, name: 'Service A' },
      { id: SERVICE_B_ID, orgId: ORG_B_ID, name: 'Service B' },
    ]);

    await db.insert(projectServiceMembers).values({
      id: PSM_B_ID,
      orgId: ORG_B_ID,
      projectId: PROJECT_B_ID,
      serviceId: SERVICE_B_ID,
      userId: USER_B_ID,
      billRate: '999.00',
      costRate: '888.00',
    });
  });

  afterAll(async () => {
    try {
      await db.delete(projectServiceMembers).where(eq(projectServiceMembers.id, PSM_B_ID));
      await db.delete(projects).where(eq(projects.id, PROJECT_A_ID));
      await db.delete(projects).where(eq(projects.id, PROJECT_B_ID));
      await db.delete(services).where(eq(services.id, SERVICE_A_ID));
      await db.delete(services).where(eq(services.id, SERVICE_B_ID));
      await db.delete(clients).where(eq(clients.id, CLIENT_A_ID));
      await db.delete(clients).where(eq(clients.id, CLIENT_B_ID));
      await db.delete(users).where(eq(users.id, USER_A_ID));
      await db.delete(users).where(eq(users.id, USER_B_ID));
      await db.delete(orgs).where(eq(orgs.id, ORG_A_ID));
      await db.delete(orgs).where(eq(orgs.id, ORG_B_ID));
    } catch (e) {
      console.error('Cleanup error:', e);
    }
  });

  it('Org A cannot see Org B rates — cross-tenant isolation', async () => {
    const result = await resolveRates({
      orgId: ORG_A_ID,
      projectId: PROJECT_B_ID,
      userId: USER_B_ID,
      serviceId: SERVICE_B_ID,
      date: new Date(),
      billable: true,
    });

    expect(result.billRate).toBe(0);
    expect(result.billRateSource).toBe('ERROR_NO_RATE');
    expect(result.costRate).toBe(0);
    expect(result.costRateSource).toBe('ZERO_FLAGGED');
    expect(result.warnings.some(w => w.includes('No bill rate'))).toBe(true);
    expect(result.warnings.some(w => w.includes('No cost rate'))).toBe(true);
  });

  it('Positive control — Org B sees its own rates', async () => {
    const result = await resolveRates({
      orgId: ORG_B_ID,
      projectId: PROJECT_B_ID,
      userId: USER_B_ID,
      serviceId: SERVICE_B_ID,
      date: new Date(),
      billable: true,
    });

    expect(result.billRate).toBe(999);
    expect(result.billRateSource).toBe('PROJECT_SERVICE_MEMBER');
    expect(result.costRate).toBe(888);
    expect(result.costRateSource).toBe('PROJECT_SERVICE_MEMBER');
    expect(result.warnings).toHaveLength(0);
  });
});
