import type { Express, Request, Response } from "express";
import { readFileSync } from "fs";
import path from "path";

function generateOpenAPISpec(): any {
  return {
    openapi: "3.1.0",
    info: {
      title: "CherryWorks Pro API",
      version: "1.0.0",
      description: "Full-stack SaaS API for professional services firms — time tracking, invoicing, payments, expenses, GL, Stripe integration.",
      contact: { name: "CherryWorks Pro Support", email: "support@cherryworkspro.com" },
      license: { name: "Proprietary" },
    },
    servers: [
      { url: "/", description: "Current server" },
    ],
    tags: [
      { name: "Auth", description: "Authentication and session management" },
      { name: "Clients", description: "Client management" },
      { name: "Projects", description: "Project management" },
      { name: "Invoices", description: "Invoice creation, sending, and management" },
      { name: "Payments", description: "Payment recording and management" },
      { name: "Time", description: "Time entries and timesheet management" },
      { name: "Expenses", description: "Expense tracking and approval" },
      { name: "GL", description: "General ledger and reconciliation" },
      { name: "Reports", description: "Financial and operational reports" },
      { name: "Admin", description: "Administrative operations" },
      { name: "Webhooks", description: "Webhook management" },
      { name: "Search", description: "Global search" },
      { name: "Portal", description: "Customer portal" },
      { name: "MFA", description: "Multi-factor authentication" },
      { name: "Integrations", description: "API keys and integrations" },
    ],
    components: {
      securitySchemes: {
        sessionAuth: { type: "apiKey", in: "cookie", name: "connect.sid", description: "Session-based authentication" },
        csrfToken: { type: "apiKey", in: "header", name: "X-CSRF-Token", description: "CSRF protection token" },
        apiKey: { type: "apiKey", in: "header", name: "X-API-Key", description: "API key authentication for v1 endpoints" },
      },
      schemas: {
        Error: { type: "object", properties: { message: { type: "string" } }, required: ["message"] },
        Client: { type: "object", properties: { id: { type: "string", format: "uuid" }, name: { type: "string" }, email: { type: "string", format: "email" }, phone: { type: "string" }, address: { type: "string" }, orgId: { type: "string", format: "uuid" } } },
        Project: { type: "object", properties: { id: { type: "string", format: "uuid" }, name: { type: "string" }, clientId: { type: "string", format: "uuid" }, status: { type: "string", enum: ["active", "completed", "on_hold", "cancelled"] }, budget: { type: "string" } } },
        Invoice: { type: "object", properties: { id: { type: "string", format: "uuid" }, number: { type: "string" }, clientId: { type: "string", format: "uuid" }, status: { type: "string", enum: ["draft", "sent", "paid", "partial", "overdue", "void"] }, total: { type: "string" }, paidAmount: { type: "string" } } },
        Payment: { type: "object", properties: { id: { type: "string", format: "uuid" }, invoiceId: { type: "string", format: "uuid" }, amount: { type: "string" }, method: { type: "string" }, paidAt: { type: "string", format: "date-time" } } },
        TimeEntry: { type: "object", properties: { id: { type: "string", format: "uuid" }, userId: { type: "string", format: "uuid" }, projectId: { type: "string", format: "uuid" }, minutes: { type: "integer" }, notes: { type: "string" }, date: { type: "string", format: "date" } } },
        Expense: { type: "object", properties: { id: { type: "string", format: "uuid" }, userId: { type: "string", format: "uuid" }, description: { type: "string" }, amount: { type: "string" }, category: { type: "string" }, status: { type: "string" } } },
        AuditLog: { type: "object", properties: { id: { type: "string", format: "uuid" }, orgId: { type: "string", format: "uuid" }, userId: { type: "string" }, action: { type: "string" }, entityType: { type: "string" }, entityId: { type: "string" }, details: { type: "object" }, createdAt: { type: "string", format: "date-time" } } },
        GLEntry: { type: "object", properties: { id: { type: "string", format: "uuid" }, accountCode: { type: "string" }, debit: { type: "string" }, credit: { type: "string" }, description: { type: "string" } } },
        User: { type: "object", properties: { id: { type: "string", format: "uuid" }, name: { type: "string" }, email: { type: "string", format: "email" }, role: { type: "string", enum: ["ADMIN", "TEAM_MEMBER"] } } },
        WebhookEndpoint: { type: "object", properties: { id: { type: "string", format: "uuid" }, url: { type: "string", format: "uri" }, events: { type: "array", items: { type: "string" } }, isActive: { type: "boolean" } } },
        WebhookDelivery: { type: "object", properties: { id: { type: "string", format: "uuid" }, event: { type: "string" }, status: { type: "string", enum: ["pending", "delivered", "failed"] }, attempts: { type: "integer" }, payload: { type: "object" }, responseBody: { type: "string" } } },
        ReconcileCheck: { type: "object", properties: { ok: { type: "boolean" }, diff: { type: "string" }, orphans: { type: "array", items: { type: "string" } }, ar_subledger_total: { type: "string" }, gl_1200_balance: { type: "string" } } },
      },
    },
    paths: {
      "/api/auth/login": {
        post: { tags: ["Auth"], summary: "Login with email and password", requestBody: { content: { "application/json": { schema: { type: "object", properties: { email: { type: "string" }, password: { type: "string" } }, required: ["email", "password"] } } } }, responses: { "200": { description: "Login successful" }, "401": { description: "Invalid credentials" } } },
      },
      "/api/auth/logout": {
        post: { tags: ["Auth"], summary: "Logout current session", security: [{ sessionAuth: [], csrfToken: [] }], responses: { "200": { description: "Logged out" } } },
      },
      "/api/auth/me": {
        get: { tags: ["Auth"], summary: "Get current user info", security: [{ sessionAuth: [] }], responses: { "200": { description: "Current user", content: { "application/json": { schema: { "$ref": "#/components/schemas/User" } } } } } },
      },
      "/api/clients": {
        get: { tags: ["Clients"], summary: "List clients", security: [{ sessionAuth: [] }], responses: { "200": { description: "Client list", content: { "application/json": { schema: { type: "array", items: { "$ref": "#/components/schemas/Client" } } } } } } },
        post: { tags: ["Clients"], summary: "Create client", security: [{ sessionAuth: [], csrfToken: [] }], requestBody: { content: { "application/json": { schema: { "$ref": "#/components/schemas/Client" } } } }, responses: { "201": { description: "Created" } } },
      },
      "/api/projects": {
        get: { tags: ["Projects"], summary: "List projects", security: [{ sessionAuth: [] }], responses: { "200": { description: "Project list" } } },
        post: { tags: ["Projects"], summary: "Create project", security: [{ sessionAuth: [], csrfToken: [] }], responses: { "201": { description: "Created" } } },
      },
      "/api/invoices": {
        get: { tags: ["Invoices"], summary: "List invoices", security: [{ sessionAuth: [] }], responses: { "200": { description: "Invoice list" } } },
        post: { tags: ["Invoices"], summary: "Create invoice", security: [{ sessionAuth: [], csrfToken: [] }], responses: { "201": { description: "Created" } } },
      },
      "/api/payments": {
        get: { tags: ["Payments"], summary: "List payments", security: [{ sessionAuth: [] }], responses: { "200": { description: "Payment list" } } },
        post: { tags: ["Payments"], summary: "Record payment", security: [{ sessionAuth: [], csrfToken: [] }], responses: { "201": { description: "Created" } } },
      },
      "/api/time-entries": {
        get: { tags: ["Time"], summary: "List time entries", security: [{ sessionAuth: [] }], responses: { "200": { description: "Time entries" } } },
        post: { tags: ["Time"], summary: "Create time entry", security: [{ sessionAuth: [], csrfToken: [] }], responses: { "201": { description: "Created" } } },
      },
      "/api/expenses": {
        get: { tags: ["Expenses"], summary: "List expenses", security: [{ sessionAuth: [] }], responses: { "200": { description: "Expenses" } } },
        post: { tags: ["Expenses"], summary: "Create expense", security: [{ sessionAuth: [], csrfToken: [] }], responses: { "201": { description: "Created" } } },
      },
      "/api/gl/reconcile/check": {
        get: { tags: ["GL"], summary: "Check GL reconciliation", security: [{ sessionAuth: [] }], responses: { "200": { description: "Reconciliation result", content: { "application/json": { schema: { "$ref": "#/components/schemas/ReconcileCheck" } } } } } },
      },
      "/api/gl/entries": {
        get: { tags: ["GL"], summary: "List GL entries", security: [{ sessionAuth: [] }], responses: { "200": { description: "GL entries" } } },
      },
      "/api/reports/revenue": {
        get: { tags: ["Reports"], summary: "Revenue report", security: [{ sessionAuth: [] }], responses: { "200": { description: "Revenue data" } } },
      },
      "/api/reports/ar-aging": {
        get: { tags: ["Reports"], summary: "AR aging report", security: [{ sessionAuth: [] }], responses: { "200": { description: "AR aging data" } } },
      },
      "/api/search/global": {
        get: { tags: ["Search"], summary: "Global search across entities", security: [{ sessionAuth: [] }], parameters: [{ name: "q", in: "query", required: true, schema: { type: "string" } }], responses: { "200": { description: "Search results" } } },
      },
      "/api/admin/webhooks/config": {
        get: { tags: ["Webhooks"], summary: "Get webhook configuration", security: [{ sessionAuth: [] }], responses: { "200": { description: "Webhook config" } } },
      },
      "/api/admin/webhooks/deliveries": {
        get: { tags: ["Webhooks"], summary: "List webhook deliveries", security: [{ sessionAuth: [] }], parameters: [{ name: "status", in: "query", schema: { type: "string" } }, { name: "event", in: "query", schema: { type: "string" } }], responses: { "200": { description: "Deliveries" } } },
      },
      "/api/mfa/status": {
        get: { tags: ["MFA"], summary: "Get MFA status", security: [{ sessionAuth: [] }], responses: { "200": { description: "MFA status" } } },
      },
      "/api/mfa/totp/setup": {
        post: { tags: ["MFA"], summary: "Setup TOTP", security: [{ sessionAuth: [], csrfToken: [] }], responses: { "200": { description: "TOTP setup data with QR code" } } },
      },
      "/api/integrations/api-keys": {
        get: { tags: ["Integrations"], summary: "List API keys", security: [{ sessionAuth: [] }], responses: { "200": { description: "API keys" } } },
        post: { tags: ["Integrations"], summary: "Create API key", security: [{ sessionAuth: [], csrfToken: [] }], responses: { "201": { description: "Created key" } } },
      },
      "/api/v1/clients": {
        get: { tags: ["Clients"], summary: "List clients via API key", security: [{ apiKey: [] }], responses: { "200": { description: "Client list" } } },
      },
      "/api/health": {
        get: { tags: ["Admin"], summary: "Health check", responses: { "200": { description: "Service health" } } },
      },
      "/api/openapi.json": {
        get: { tags: ["Admin"], summary: "OpenAPI 3.1 specification", responses: { "200": { description: "OpenAPI spec" } } },
      },
    },
  };
}

const SWAGGER_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>CherryWorks Pro API Docs</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui.css" />
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({
      url: '/api/openapi.json',
      dom_id: '#swagger-ui',
      deepLinking: true,
      presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
      layout: "BaseLayout",
    });
  </script>
</body>
</html>`;

export function registerOpenAPIRoutes(app: Express) {

app.get("/api/openapi.json", (_req: Request, res: Response) => {
  const spec = generateOpenAPISpec();
  res.setHeader("Content-Type", "application/json");
  res.json(spec);
});

app.get("/api/docs", (_req: Request, res: Response) => {
  res.setHeader("Content-Type", "text/html");
  res.send(SWAGGER_HTML);
});

app.get("/api/openapi/stats", (_req: Request, res: Response) => {
  const spec = generateOpenAPISpec();
  const pathCount = Object.keys(spec.paths).length;
  const schemaCount = Object.keys(spec.components.schemas).length;
  const tagCount = spec.tags.length;
  let operationCount = 0;
  for (const methods of Object.values(spec.paths) as any[]) {
    operationCount += Object.keys(methods).length;
  }
  res.json({
    version: spec.openapi,
    title: spec.info.title,
    pathCount,
    operationCount,
    schemaCount,
    tagCount,
    tags: spec.tags.map((t: any) => t.name),
  });
});

}
