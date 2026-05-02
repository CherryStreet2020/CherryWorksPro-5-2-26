# Bundle 31 — Test Report
**Date:** 2026-04-15
**Tester:** Replit Agent
**Environment:** Development (localhost:5000)

## FIX 1: PDF Generation Proof

### QA-0001 Invoice State
- Invoice ID: `90862431-5d44-45ee-8738-b2d9eb4cc51a`
- Total: $1,000.00
- Line count after backfill: 1 (QA Test Service, qty 1, $1000.00)

### PDF Generation Result
- HTTP Status: 200
- Content-Type: application/pdf
- File Size: 2,266 bytes
- Header (first 5 bytes): `%PDF-`

### Error Handling Verification
- Before fix: HTTP 500 with `{"message":"PDF generation failed"}`
- After fix (no lines): HTTP 400 with `{"message":"Cannot generate PDF: Invoice has no line items"}`
- After backfill (with lines): HTTP 200 with valid PDF

### Invoice Guards
- POST /api/invoices: Rejects body with total > 0 and empty/missing lines (400)
- PATCH /api/invoices/:id: Rejects if result has total > 0 and no lines (400)
- POST /api/invoices/:id/send: Rejects sending with no lines (400)

## FIX 2: Service Names Verification

### Updated Service Suggestions in getting-started.tsx
1. Strategy (rate: $250)
2. Implementation (rate: $175)
3. Information Technology (rate: $185)
4. Project Management (rate: $145)
5. UX Design (rate: $165)
6. Development (rate: $150)

### "Consulting" Search Result
```
grep -r "Consulting" client/src/pages/getting-started.tsx
No matches found
```

### Placeholder Text
- Before: `Service name (e.g. Consulting)`
- After: `Service name (e.g. Strategy)`

### Checklist Text
- Before: `e.g. Strategy Consulting, Development, Design`
- After: `e.g. Strategy, Development, Design`

### Unit Tests
- tests/unit/services.test.ts: 11 passed
- tests/unit/admin-data-console.test.ts: 18 passed
- Total: 29 passed, 0 failed

## FIX 3: Project Member-Count Consistency

### Data Source Alignment
- Before: KPI used `/api/canonical/active-team` (org-wide team count)
- After: KPI uses `project.members` arrays from `/api/projects` response (same source as project detail page)

### KPI Label Change
- Before: "X total members"
- After: "X assigned members"

### Consistency Check
- Projects with 0 members: KPI contributes 0 to total, detail page shows "No members"
- Projects with N members: KPI contributes N to total, detail page shows N member badges
- Both views derive from the same `project.members` data source
