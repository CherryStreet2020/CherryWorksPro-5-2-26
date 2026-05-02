# B10 Fix Batch — F24 + F23 + F28 Proof Bundle

**Date:** 2026-04-09
**Baseline:** AR $915.95 / SvcRev $2,187.50 / TB $2,419.70 balanced
**Org:** Cherry Street Consulting (`30cb6705-f98e-44c5-8e2a-fbe3f150a3eb`)

---

## F24 — Revenue Chart Y-Axis Clipping (FIXED)

### Problem
The `domain={[0, 'auto']}` fix from B9 did not resolve the issue. Recharts `'auto'` rounds down to the nearest nice number below the max, causing the March 2026 invoiced bar (~$1,925) to clip at the $2,000 axis ceiling.

### Fix
Replaced the YAxis domain with an explicit padding function:

```tsx
<YAxis domain={[0, (dataMax: number) => Math.ceil(dataMax * 1.1 / 500) * 500]} />
```

This pads 10% above the max data value and rounds up to the nearest $500 increment.

### File Changed
`client/src/pages/reports.tsx` line 241

### Proof
```
Revenue data:
  2026-03: invoiced=$1,925  paid=$872.76
  2026-04: invoiced=$262.50 paid=$541.00

Max data value:    $1,925
YAxis ceiling:     $2,500 (after fix)
Headroom:          29.9% (tallest bar has visible whitespace above it)
```

**Before:** Bar touched $2,000 ceiling (clipped)
**After:** YAxis extends to $2,500, tallest bar ($1,925) has clear headroom

---

## F23 — Banking Reconciliation End-to-End (FIXED + PERSISTED)

### Problem
B9 tested the batch reconciliation API via curl then reverted to MATCHED. No user-facing state change was persisted. Banking UI still showed 99 PENDING / 1 MATCHED / 0 RECONCILED.

### Fix
No code fix needed — the reconciliation endpoint and UI were already functional. The issue was that B9 reverted the state after testing.

### Playwright Test
Ran end-to-end Playwright test with these steps:
1. Login as Dean → redirect to dashboard
2. Navigate to /banking
3. Click "Reconciliation" tab (data-testid="tab-reconciliation")
4. Verified pre-state: Matched=1, Reconciled=0, "1 matched transaction ready to reconcile" message, "Reconcile All Matched" button visible
5. Clicked "Reconcile All Matched" (data-testid="button-batch-reconcile-all-matched")
6. Verified post-state: Matched=0, Reconciled=1, batch reconcile button no longer visible, success toast appeared

### Test Result
```
Status: SUCCESS
Output: "Completed the banking reconciliation end-to-end flow. Logged in with the
provided credentials, verified redirect to the authenticated dashboard, navigated
to /banking, opened the Reconciliation tab, confirmed the pre-action state,
clicked Reconcile All Matched, and verified the updated state: Matched = 0,
Reconciled = 1, the batch reconcile button is no longer shown, and a toast
confirms the batch reconciliation."
```

### Proof — Persisted State
```
Bank transaction statuses (API verified):
  PENDING:    99
  RECONCILED:  1  (was MATCHED, now permanently RECONCILED)
  MATCHED:     0
```

Transaction id=9 ($500.00 Apple Cash bank transfer) matched to invoice payment `b5842766-651b-4f0b-ace0-ac64cdda369f` is now permanently reconciled.

**State NOT reverted — Dean can see it live.**

---

## F28 — Services Catalog Pollution (FIXED)

### Problem
Settings → Services showed 4 test entries:
- "DEEP-SCAN Service" (description: "test")
- "Proof Test Service" (description: "R6 proof test")
- "R3-SvcUp"
- "R3-TestSvcUp"

### Fix
Deleted all services matching test/proof/DEEP-SCAN/R3 patterns (org-scoped):

```sql
DELETE FROM services WHERE org_id = '30cb6705-f98e-44c5-8e2a-fbe3f150a3eb'
  AND (name ILIKE '%test%' OR name ILIKE '%proof%' OR name ILIKE '%DEEP-SCAN%'
       OR name ILIKE 'R3-%' OR name ILIKE 'R6%');
-- DELETE 4
```

### Proof — Remaining Services (6 legitimate)
```
 Data & Analytics
 IT Consulting
 Implementation Services
 Project Management
 Strategy Consulting
 Training & Enablement
```

Zero test pollution. All entries are real billable service categories.

Verified via Playwright test: navigated to /settings, confirmed only the 6 legitimate services are listed.

---

## Canonical Baseline Verification (UNCHANGED)

| Metric | Expected | Actual | Status |
|--------|----------|--------|--------|
| GL AR (acct 1200) | $915.95 | $915.95 | ✓ |
| GL Service Revenue (acct 4000) | $2,187.50 | $2,187.50 | ✓ |
| Net Trial Balance DR | $2,419.70 | $2,419.70 | ✓ |
| Net Trial Balance CR | $2,419.70 | $2,419.70 | ✓ |
| TB Difference | $0.00 | $0.00 | ✓ |
| Gross TB DR=CR | $5,920.82 | $5,920.82 | ✓ |

---

## Pages Affected

| Page | Finding | Change | Verification |
|------|---------|--------|--------------|
| Reports → Revenue | F24 | Code: YAxis domain padding function | Playwright + API: $2,500 ceiling > $1,925 max bar |
| Banking → Reconciliation | F23 | State: 1 txn reconciled (persisted) | Playwright: Matched 1→0, Reconciled 0→1 |
| Settings → Services | F28 | Data: 4 test services deleted | Playwright + DB: 6 legitimate services remain |

---

## Files Changed

| File | Lines Changed |
|------|--------------|
| `client/src/pages/reports.tsx` | 1 line (YAxis domain) |

Data-only changes (no code): services table cleanup, bank_transactions status update.

---

## Acceptance Criteria Checklist

- [x] Reports → Revenue chart: tallest bar has whitespace above it; Y-axis max ($2,500) > tallest bar ($1,925)
- [x] Banking: shows 1 reconciled (not 0) with persisted state
- [x] Settings → Services: zero test pollution (6 legitimate services)
- [x] Canonical baseline unchanged: AR $915.95 / SvcRev $2,187.50 / TB $2,419.70
- [x] Playwright test output included for F23
- [x] NOT republished
