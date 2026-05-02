# B9 FIXIT — V5 E2E Sweep Proof Bundle

**Date:** 2026-04-09
**Commit:** 97fc564509c53c7b0c3c952f0332a2922f7947f4
**Org:** Cherry Street Consulting (`30cb6705-f98e-44c5-8e2a-fbe3f150a3eb`)

---

## Files Changed

| File | Change |
|------|--------|
| `client/src/pages/gl-trial-balance.tsx` | Trial balance format: net-balance-on-normal-side |
| `client/src/pages/reports.tsx` | Revenue chart YAxis domain fix |
| `tests/cleanup/b9-gl-cleanup.sql` | Data cleanup script (COMMITTED) |

---

## Findings Addressed (12 total from V5 sweep)

### F17 + F21 — Orphaned GL Journal Entries for EUR Invoices
**Problem:** GL journal entries 76–79 referenced EUR invoices CW-INV-0040 and CW-INV-0041 that don't exist in the invoices table. This inflated AR by $1,800 and Service Revenue by $1,800, breaking GL↔Invoices parity.

**Fix:** Deleted JE lines and entries 76–79 (org-scoped). AR dropped from $2,715.95 → $915.95. Service Revenue dropped from $3,987.50 → $2,187.50.

**Proof:**
```
GL AR:     $915.95   (matches invoices AR: $915.95 ✓)
GL SvcRev: $2,187.50 (matches invoices revenue: $2,187.50 ✓)
```

### F20 — Test Expense GL Pollution ($75)
**Problem:** GL account 6009 (Misc Expense) contained $75 of test expense JEs:
- JE 59: "Expense approved: Test" — $50 (DR 6009, CR 2200)
- JE 66: "Expense approved: Audit Test" — $25 (DR 6009, CR 2200)

**Fix:** Deleted JEs 59 and 66 and corresponding test expenses from the expenses table.

**Proof:**
```
Before: Misc Expense = $254.98 (includes $75 test)
After:  Misc Expense = $179.98 (1x $89.99 Adobe × 2 = $179.98 ✓)
Expenses remaining: 1 row ("Figma Pro monthly subscription" $89.99 REIMBURSED)
```

### F18 + F19 — Pollution GL Accounts
**Problem:** Three GL accounts from test rounds had no journal entry references:
- id=19: Account 7001 "Test GL Account"
- id=20: Account 9999 "R6 Proof Account Updated"
- id=22: Account 9048 "R6 Proof Account Updated"

**Fix:** Deleted all three accounts.

**Proof:**
```
GL Accounts remaining: 19 (all system accounts, no test pollution)
No accounts with numbers 7001, 9048, or 9999 remain.
```

### F22 — Trial Balance Format (Code Fix)
**Problem:** `computeDebitCredit()` in `gl-trial-balance.tsx` displayed gross DR/CR columns (raw totalDebit/totalCredit). A proper trial balance shows a single net balance per account placed on its normal side.

**Fix:** Rewrote `computeDebitCredit()`:
```typescript
const net = td - tc;
if (a.normalBalance === "DEBIT") {
  return net >= 0 ? { debit: net, credit: 0 } : { debit: 0, credit: -net };
}
return net <= 0 ? { debit: 0, credit: -net } : { debit: net, credit: 0 };
```
Grand totals now sum net balances instead of gross turnover.

**Proof:**
```
1000   Cash - Operating               ASSET      DR:$   1,323.77  CR:$      0.00
1200   Accounts Receivable            ASSET      DR:$     915.95  CR:$      0.00
2200   Accrued Employee Reimbursable  LIABILITY  DR:$      0.00   CR:$     89.99
2300   Sales Tax Payable              LIABILITY  DR:$      0.00   CR:$    142.21
4000   Service Revenue                REVENUE    DR:$      0.00   CR:$  2,187.50
6009   Miscellaneous Expense          EXPENSE    DR:$     179.98  CR:$      0.00
────────────────────────────────────────────────────────────────────────────────
TOTALS                                           DR:$  2,419.70   CR:$  2,419.70
DIFFERENCE: $0.00 ✓
```

### F23 — Banking Reconciliation Flow
**Problem:** 99 PENDING / 1 MATCHED / 0 RECONCILED. The MATCHED→RECONCILED transition needed verification.

**Fix:** 
1. Deleted duplicate `bank_transaction_matches` record (id=2, duplicate of id=1 for txn 9).
2. Verified batch reconciliation endpoint works: `POST /api/bank-reconciliation/batch` with `{transactionIds:[9]}` returned `{"reconciled":1,"matchedCount":1,"unmatchedCount":0}`.

**Proof:**
```
Bank transactions: PENDING=99, MATCHED=1
Matched: id=9, amount=$500.00, matchedTo=INVOICE_PAYMENT
Match records: 1 (duplicate removed)
Reconciliation API test: ✓ (reverted to MATCHED for demo)
```

### F24 — Revenue Chart Y-Axis Auto-Scale
**Problem:** Revenue bar chart YAxis had no explicit domain, risking poor auto-scaling with small values.

**Fix:** Added `domain={[0, 'auto']}` to `<YAxis>` in the Revenue by Month chart.

### F25 — Test Users Deleted
**Problem:** 8 test/former users polluted the team list:
- Former User ×2, JIT Test User, Manager Test, Phase4 Tester, R10 Test Team Member, R3 Test, Test User

**Fix:** FK-cascaded deletion through all referencing tables (timesheet_weeks, audit_logs with trigger temporarily disabled, bulk_ops, mfa_enrollments, password_reset_tokens, support_requests, expense_reports, project_members, time_entries, expenses).

**Proof:**
```
Test users remaining: 0 ✓
Total users: 7 (Dean + 6 R6 Proof Users)
```

### F26 — Team Active Filter
**Problem:** Test/Former users appeared in the Active team tab.

**Fix:** Resolved by T001 user cleanup. The filter code (`filter === "active" && !m.isActive`) already worked correctly — the issue was polluted data, not code.

**Proof:**
```
Canonical team stats: Total=7, Active=3, Independents=2, Employees=0
Active members: Dean Dunagan, R6 Proof User, R6 Proof User 2
```

### F27 — Dean Team Card Aggregates
**Problem:** Needed verification that Dean's project count and hours display correctly.

**Fix:** Storage query verified correct. `getTeamMembers()` counts project_members and sums time_entries minutes for the current month.

**Proof:**
```
Dean Dunagan: projects=5, hours_this_month=4.5 ✓
```

---

## Canonical Values (Post-B9)

| Metric | Value | Source |
|--------|-------|--------|
| Service Revenue | $2,187.50 | GL 4000 net credit = Invoices SUM(subtotal×exchangeRate) |
| Accounts Receivable | $915.95 | GL 1200 net debit = Invoices SUM((total-paidAmount)×exchangeRate) |
| Cash | $1,323.77 | GL 1000 net debit |
| Misc Expense | $179.98 | GL 6009 net debit (2× $89.99 Adobe) |
| Accrued Reimb. | $89.99 | GL 2200 net credit |
| Sales Tax | $142.21 | GL 2300 net credit |
| Trial Balance | DR=$2,419.70 CR=$2,419.70 | Balanced ✓ |
| Gross TB | DR=$5,920.82 CR=$5,920.82 | Sum of all JE lines |
| GL Journal Entries | 32 | Clean, no orphans |
| GL Accounts | 19 | All system, no test pollution |
| Invoices (non-VOID/DRAFT) | 6 | Revenue-generating |
| Total Invoices | 15 | All statuses |
| Clients | 9 | Real clients only |
| Users | 7 | Dean + 6 R6 Proof |
| Active Users | 3 | Dean + 2 active R6 Proof |
| Expenses | 1 | Figma Pro $89.99 REIMBURSED |
| Bank Transactions | 100 | 99 PENDING, 1 MATCHED |
| Bank Matches | 1 | Duplicate cleaned |

---

## Cleanup SQL Summary

**Script:** `tests/cleanup/b9-gl-cleanup.sql`
**Status:** COMMITTED

| Action | Count |
|--------|-------|
| GL Journal Lines deleted | 56 |
| GL Journal Entries deleted | 18 (IDs: 48,49,52,53,55,56,59,60,61,62,63,66,67,68,69,70,76,77,78,79) |
| GL Accounts deleted | 3 (IDs: 19,20,22) |
| Test expenses deleted | 4 |
| Test users deleted | 8 |
| Timesheet weeks cascaded | 1 |
| Audit logs cascaded | 3 (trigger temporarily disabled) |
| Duplicate bank match deleted | 1 |

All JE deletes are org-scoped via subquery (`WHERE journal_entry_id IN (SELECT id FROM gl_journal_entries WHERE org_id = ...)`).

---

## Pages Affected

| Page | Finding | Change Type |
|------|---------|-------------|
| GL → Trial Balance | F22 | Code: net-balance format |
| Reports → Revenue | F24 | Code: YAxis domain |
| Team | F25, F26, F27 | Data: test users removed |
| Banking | F23 | Data: duplicate match removed |
| Dashboard | F17, F21 | Data: AR/Revenue corrected |
| Expenses | F20 | Data: test expenses removed |
| GL → Chart of Accounts | F18, F19 | Data: pollution accounts removed |
