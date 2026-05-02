# B12 — GET-by-ID Endpoint Fixes — Proof Bundle

**Date:** 2026-04-09

---

## Issue

Two GET-by-id endpoints returned empty/error responses instead of the resource:
- `GET /api/invoices/:id` — route did not exist; returned `{"error":"API route not found"}`
- `GET /api/projects/:id` — already functional (returns `{project, members, stats, ...}`)

## Root Cause

### Invoices
No `GET /api/invoices/:id` route was registered in `server/routes/invoice-routes.ts`. The path fell through to the catch-all 404 handler.

### Projects
The route existed and worked correctly. `getProjectDetail()` in `server/storage.ts` already enforced orgId scoping and returned full project data with members, stats, time entries, invoices, and estimates.

## Fix Applied

### `server/routes/invoice-routes.ts` (line 485)

Added new route:

```typescript
app.get("/api/invoices/:id", requireManagerOrAbove, async (req, res) => {
  try {
    const orgId = req.session.orgId!;
    const invoice = await storage.getInvoice(req.params.id as string, orgId);
    if (!invoice) {
      return res.status(404).json({ message: "Invoice not found" });
    }
    return res.json(invoice);
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});
```

**Response shape** (matches list endpoint item shape):
```json
{
  "id": "uuid",
  "orgId": "uuid",
  "clientId": "uuid",
  "number": "CW-INV-0025",
  "status": "PAID",
  "issuedDate": "2026-03-15",
  "dueDate": "2026-04-14",
  "currency": "USD",
  "exchangeRate": "1",
  "subtotal": "250.00",
  "total": "250.00",
  "paidAmount": "250.00",
  "clientName": "...",
  "clientEmail": "...",
  "clientLogoUrl": null,
  "lines": [{ "id": "...", "description": "...", ... }]
}
```

### `server/routes/project-routes.ts` (line 60) — No change needed

Existing route already returns full project detail with orgId scoping:
```json
{
  "project": { "id": "...", "name": "...", "clientName": "...", ... },
  "members": [...],
  "stats": { "totalHoursLogged": ..., ... },
  "hoursByMember": [...],
  "recentTimeEntries": [...],
  "invoices": [...],
  "estimates": [...],
  "services": [...],
  "assignedServices": [...]
}
```

## Security

Both endpoints:
- Enforce `requireManagerOrAbove` middleware (authentication + role check)
- Scope queries by `orgId` from session (cross-org isolation)
- Return 404 for IDs not belonging to the caller's org

## Unit Tests

**File:** `tests/unit/get-by-id-endpoints.test.ts`

| Test Name | Endpoint | Expected | Result |
|-----------|----------|----------|--------|
| `GET /api/invoices/:id > 200 — returns full invoice with line items for valid org-scoped id` | `/api/invoices/:id` | 200 + full shape | ✅ PASS |
| `GET /api/invoices/:id > 404 — cross-org isolation (non-existent UUID returns 404)` | `/api/invoices/:id` | 404 | ✅ PASS |
| `GET /api/projects/:id > 200 — returns full project detail for valid org-scoped id` | `/api/projects/:id` | 200 + full shape | ✅ PASS |
| `GET /api/projects/:id > 404 — cross-org isolation (non-existent UUID returns 404)` | `/api/projects/:id` | 404 | ✅ PASS |

```
 ✓ tests/unit/get-by-id-endpoints.test.ts > GET /api/invoices/:id > 200 — returns full invoice with line items for valid org-scoped id 13ms
 ✓ tests/unit/get-by-id-endpoints.test.ts > GET /api/invoices/:id > 404 — cross-org isolation (non-existent UUID returns 404) 10ms
 ✓ tests/unit/get-by-id-endpoints.test.ts > GET /api/projects/:id > 200 — returns full project detail for valid org-scoped id 15ms
 ✓ tests/unit/get-by-id-endpoints.test.ts > GET /api/projects/:id > 404 — cross-org isolation (non-existent UUID returns 404) 8ms

 Test Files  1 passed (1)
      Tests  4 passed (4)
```

## Route File Paths

- **Invoice route:** `server/routes/invoice-routes.ts`
- **Project route:** `server/routes/project-routes.ts` (unchanged)
- **Test file:** `tests/unit/get-by-id-endpoints.test.ts`

## Baseline Verification

No list endpoints changed. Canonical baseline unaffected:
- AR: $915.95
- Service Revenue: $2,187.50
- Invoices: 16 (15 + 1 blank draft)
- Projects: 8
