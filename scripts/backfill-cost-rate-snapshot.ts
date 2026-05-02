import { db } from '../server/db';
import { timeEntries } from '../shared/schema';
import { resolveRates } from '../server/services/rate-resolver';
import { eq, isNull } from 'drizzle-orm';

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  if (DRY_RUN) {
    console.log('=== DRY RUN MODE — no rows will be updated ===\n');
  }

  const rows = await db
    .select({
      id: timeEntries.id,
      orgId: timeEntries.orgId,
      projectId: timeEntries.projectId,
      userId: timeEntries.userId,
      serviceId: timeEntries.serviceId,
      date: timeEntries.date,
      billable: timeEntries.billable,
    })
    .from(timeEntries)
    .where(isNull(timeEntries.costRateSnapshot))
    .orderBy(timeEntries.id);

  const total = rows.length;
  console.log(`Backfilling ${total} rows...\n`);

  if (total === 0) {
    console.log('Nothing to backfill.');
    process.exit(0);
  }

  let totalProcessed = 0;
  let updatedWithRate = 0;
  let updatedWithZero = 0;
  let errors = 0;

  const BATCH_SIZE = 500;

  for (let i = 0; i < total; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);

    for (const row of batch) {
      totalProcessed++;
      try {
        const resolved = await resolveRates({
          orgId: row.orgId,
          projectId: row.projectId,
          userId: row.userId,
          serviceId: row.serviceId ?? null,
          date: new Date(row.date),
          billable: row.billable ?? true,
        });

        const costVal = resolved.costRate.toFixed(2);

        if (!DRY_RUN) {
          await db
            .update(timeEntries)
            .set({ costRateSnapshot: costVal })
            .where(eq(timeEntries.id, row.id));
        }

        if (Number(costVal) > 0) {
          updatedWithRate++;
        } else {
          updatedWithZero++;
        }
      } catch (err: any) {
        errors++;
        console.error(`Error on row ${row.id}: ${err.message}`);
      }

      if (totalProcessed % 100 === 0 || totalProcessed === total) {
        const pct = ((totalProcessed / total) * 100).toFixed(1);
        console.log(`Processed ${totalProcessed}/${total} (${pct}% complete)`);
      }
    }
  }

  console.log('\n=== BACKFILL SUMMARY ===');
  console.log(`Total processed:    ${totalProcessed}`);
  console.log(`Updated with rate:  ${updatedWithRate}`);
  console.log(`Updated with zero:  ${updatedWithZero}`);
  console.log(`Errors:             ${errors}`);
  console.log(`Mode:               ${DRY_RUN ? 'DRY RUN' : 'REAL'}`);

  process.exit(0);
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
