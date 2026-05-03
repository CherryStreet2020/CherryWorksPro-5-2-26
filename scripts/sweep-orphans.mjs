import { sweepAbandonedRuns, closeIsolationPool } from "../tests/helpers/po/isolation.ts";
const r = await sweepAbandonedRuns(0);
console.log(JSON.stringify(r));
await closeIsolationPool();
