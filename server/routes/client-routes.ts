import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { and, eq } from "drizzle-orm";
import { randomBytes } from "crypto";
import { clients, createClientSchema, projects, projectMembers } from "@shared/schema";
import { db } from "../db";
import { sanitizeErrorMessage, requireAdmin, requireManagerOrAbove, requireAuth, fetchClientLogo } from "./middleware";
import { fireWebhookEvent } from "../webhooks";

export function registerClientRoutes(app: Express) {
app.get("/api/clients", requireManagerOrAbove, async (req, res) => {
  const page = req.query.page ? Number(req.query.page) : undefined;
  const pageSize = Math.min(req.query.pageSize ? Number(req.query.pageSize) : 25, 200);
  const currentUser = await storage.getUserById(req.session.userId!);
  const result = await storage.getClientsByOrg(req.session.orgId!, { page, pageSize });
  const stripPortal = ({ portalToken, ...rest }: any) => rest;
  const isManager = currentUser?.role === "ADMIN" || currentUser?.role === "MANAGER";

  if (!isManager) {
    const memberClientRows = await db
      .select({ clientId: projects.clientId })
      .from(projectMembers)
      .innerJoin(projects, eq(projectMembers.projectId, projects.id))
      .where(and(eq(projectMembers.orgId, req.session.orgId!), eq(projectMembers.userId, req.session.userId!)));
    const allowed = new Set(memberClientRows.map(r => r.clientId));
    if (Array.isArray(result)) {
      return res.json(result.filter((c: any) => allowed.has(c.id)).map(stripPortal));
    }
    const data = (result as any).data || [];
    return res.json({ ...(result as any), data: data.filter((c: any) => allowed.has(c.id)).map(stripPortal) });
  }

  const stripped = Array.isArray(result)
    ? result.map(stripPortal)
    : { ...(result as any), data: (result as any).data?.map(stripPortal) };
  return res.json(stripped);
});
app.post("/api/clients", requireManagerOrAbove, async (req, res) => {
  try {
    const parsed = createClientSchema.parse(req.body);
    const org = await storage.getOrg(req.session.orgId!);

    const planLimits: Record<string, number> = { TRIAL: 5, STARTER: 5, PRO: 999999, PROFESSIONAL: 999999, BUSINESS: 999999, ENTERPRISE: 999999 };
    const maxClients = planLimits[org?.planTier || "TRIAL"] || 5;
    const existingClients = await storage.getClientsByOrg(req.session.orgId!);
    if (existingClients.length >= maxClients) {
      return res.status(403).json({
        message: `Your ${org?.planTier || "Starter"} plan supports up to ${maxClients} clients. Upgrade to Professional for unlimited clients.`,
        upgradeRequired: true,
        currentPlan: org?.planTier || "TRIAL",
        clientCount: existingClients.length,
        clientLimit: maxClients,
      });
    }

    const { randomBytes } = await import("crypto");
    const portalToken = randomBytes(32).toString("hex");
    let logoUrl: string | null = null;
    if (parsed.website) {
      logoUrl = await fetchClientLogo(parsed.website);
    }
    const client = await storage.createClient({
      orgId: req.session.orgId!,
      name: parsed.name,
      email: parsed.email || null,
      phone: parsed.phone || null,
      address: parsed.address || null,
      website: parsed.website || null,
      logoUrl,
      currency: parsed.currency || org?.baseCurrency || "USD",
      portalToken,
    });
    fireWebhookEvent(req.session.orgId!, "client.created", { id: client.id, name: client.name, email: client.email });
    return res.json(client);
  } catch (err: any) {
    return res.status(400).json({ message: sanitizeErrorMessage(err) });
  }
});
app.get("/api/clients/:id", requireAuth, async (req, res) => {
  const detail = await storage.getClientDetail(req.params.id as string, req.session.orgId!);
  if (!detail) return res.status(404).json({ message: "Client not found" });

  const now = new Date();
  let score = 100;

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let overdueCount = 0;
  for (const inv of detail.invoices || []) {
    if (["DRAFT", "VOID", "PAID"].includes(inv.status)) continue;
    const outstanding = Number(inv.total) - Number(inv.paidAmount || 0);
    if (outstanding <= 0) continue;
    if (inv.dueDate) {
      const due = new Date(inv.dueDate + "T00:00:00");
      if (due < today) overdueCount++;
    }
  }
  score -= Math.min(overdueCount, 3) * 15;

  const totalBilled = Number(detail.totalBilled || 0);
  const totalPaid = Number(detail.totalPaid || 0);
  const collectionRate = totalBilled > 0 ? totalPaid / totalBilled : 1;
  if (collectionRate < 0.5) score -= 25;
  else if (collectionRate < 0.8) score -= 10;

  const ninetyDaysAgo = new Date(now.getTime() - 90 * 86400000);
  const hasRecentInvoice = (detail.invoices || []).some((inv: any) => {
    if (!inv.issuedDate) return false;
    try {
      return new Date(inv.issuedDate + "T00:00:00") >= ninetyDaysAgo;
    } catch {
      return false;
    }
  });
  const hasRecentTime = (detail.recentTimeEntries || []).some((te: any) => {
    if (!te.date) return false;
    try {
      return new Date(te.date + "T00:00:00") >= ninetyDaysAgo;
    } catch {
      return false;
    }
  });
  if (!hasRecentInvoice && !hasRecentTime) score -= 20;

  const activeProjects = (detail.projects || []).filter((p: any) => p.status === "ACTIVE").length;
  if (activeProjects === 0) score -= 10;

  const outstanding = Number(detail.outstanding || 0);
  if (outstanding > 10000) score -= 15;
  else if (outstanding > 5000) score -= 8;

  const healthScore = Math.max(0, Math.min(100, score));
  return res.json({ ...detail, healthScore });
});
app.patch("/api/clients/:id", requireManagerOrAbove, async (req, res) => {
  try {
    const parsed = createClientSchema.partial().parse(req.body);
    const updates: any = { ...parsed };
    if (parsed.website !== undefined) {
      const existing = await storage.getClientById(req.params.id as string, req.session.orgId!);
      if (parsed.website && parsed.website !== existing?.website) {
        updates.logoUrl = await fetchClientLogo(parsed.website);
      } else if (!parsed.website) {
        updates.logoUrl = null;
      }
    }
    const client = await storage.updateClient(req.params.id as string, req.session.orgId!, updates);
    if (!client) return res.status(404).json({ message: "Client not found" });
    return res.json(client);
  } catch (err: any) {
    return res.status(400).json({ message: sanitizeErrorMessage(err) });
  }
});
app.delete("/api/clients/:id", requireManagerOrAbove, async (req, res) => {
  try {
    const result = await storage.deleteClient(req.params.id as string, req.session.orgId!);
    if (!result.deleted) {
      return res.status(409).json({ message: `Cannot delete client: has linked ${result.conflict}. Remove them first.` });
    }
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});
app.get("/api/clients/:clientId/contacts", requireAuth, async (req, res) => {
  try {
    const contacts = await storage.getContactsByClient(req.params.clientId as string, req.session.orgId!);
    return res.json(contacts);
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});
app.post("/api/clients/:clientId/contacts", requireManagerOrAbove, async (req, res) => {
  try {
    const orgId = req.session.orgId!;
    const clientId = req.params.clientId as string;
    const client = await storage.getClient(clientId, orgId);
    if (!client) return res.status(404).json({ message: "Client not found" });

    const { firstName, lastName, email, phone, role, isPrimary, notes } = req.body;
    if (!firstName || !lastName) return res.status(400).json({ message: "First name and last name are required" });

    const contact = await storage.createContact({
      orgId,
      clientId,
      firstName,
      lastName,
      email: email || null,
      phone: phone || null,
      role: role || null,
      isPrimary: isPrimary ?? false,
      notes: notes || null,
    });
    await storage.createClientActivity({
      orgId,
      clientId,
      userId: req.session.userId || null,
      type: "CONTACT_ADDED",
      title: `Contact added: ${firstName} ${lastName}`,
      description: role ? `Role: ${role}` : null,
      linkUrl: null,
      metadata: { contactId: contact.id },
    });
    return res.status(201).json(contact);
  } catch (err: any) {
    return res.status(400).json({ message: sanitizeErrorMessage(err) });
  }
});
app.patch("/api/clients/:clientId/contacts/:id", requireManagerOrAbove, async (req, res) => {
  try {
    const orgId = req.session.orgId!;
    const contactId = req.params.id as string;
    const clientId = req.params.clientId as string;
    const existing = await storage.getContactById(contactId, orgId);
    if (!existing || existing.clientId !== clientId) return res.status(404).json({ message: "Contact not found" });

    const { firstName, lastName, email, phone, role, isPrimary, notes } = req.body;
    const updates: Record<string, any> = {};
    if (firstName !== undefined) updates.firstName = firstName;
    if (lastName !== undefined) updates.lastName = lastName;
    if (email !== undefined) updates.email = email || null;
    if (phone !== undefined) updates.phone = phone || null;
    if (role !== undefined) updates.role = role || null;
    if (isPrimary !== undefined) updates.isPrimary = isPrimary;
    if (notes !== undefined) updates.notes = notes || null;

    const contact = await storage.updateContact(contactId, orgId, updates);
    if (!contact) return res.status(404).json({ message: "Contact not found" });
    return res.json(contact);
  } catch (err: any) {
    return res.status(400).json({ message: sanitizeErrorMessage(err) });
  }
});
app.delete("/api/clients/:clientId/contacts/:id", requireManagerOrAbove, async (req, res) => {
  try {
    const orgId = req.session.orgId!;
    const contactId = req.params.id as string;
    const existing = await storage.getContactById(contactId, orgId);
    if (!existing || existing.clientId !== req.params.clientId) {
      return res.status(404).json({ message: "Contact not found" });
    }
    const deleted = await storage.deleteContact(contactId, orgId);
    if (!deleted) return res.status(404).json({ message: "Contact not found" });
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});
app.post("/api/clients/:id/generate-portal-link", requireManagerOrAbove, async (req, res) => {
  try {
    const clientId = req.params.id as string;
    const orgId = req.session.orgId!;
    const client = await storage.getClientById(clientId, orgId);
    if (!client) {
      return res.status(404).json({ message: "Client not found" });
    }
    const { randomBytes } = await import("crypto");
    const token = randomBytes(32).toString("hex");
    await storage.updateClient(clientId, orgId, { portalToken: token });
    await storage.createAuditLog({
      orgId,
      userId: req.session.userId!,
      action: "CLIENT_PORTAL_GENERATED",
      entityType: "client",
      entityId: clientId,
      details: { clientName: client.name },
    });
    await storage.createClientActivity({
      orgId,
      clientId,
      userId: req.session.userId || null,
      type: "PORTAL_REGENERATED",
      title: "Client portal link regenerated",
      description: null,
      linkUrl: `/portal/${token}`,
      metadata: null,
    });
    return res.json({ portalToken: token, portalUrl: `/portal/${token}` });
  } catch (err: any) {
    return res.status(400).json({ message: sanitizeErrorMessage(err) });
  }
});
// ============================================================
// Client Notes
// ============================================================
app.get("/api/clients/:clientId/notes", requireAuth, async (req, res) => {
  try {
    const notes = await storage.getClientNotesByClient(req.params.clientId as string, req.session.orgId!);
    return res.json(notes);
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

app.post("/api/clients/:clientId/notes", requireManagerOrAbove, async (req, res) => {
  try {
    const orgId = req.session.orgId!;
    const clientId = req.params.clientId as string;
    const userId = req.session.userId!;
    const client = await storage.getClient(clientId, orgId);
    if (!client) return res.status(404).json({ message: "Client not found" });

    const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";
    if (!body) return res.status(400).json({ message: "Note body is required" });
    const isPinned = !!req.body?.isPinned;

    const note = await storage.createClientNote({
      orgId,
      clientId,
      authorId: userId,
      body,
      isPinned,
    });
    await storage.createClientActivity({
      orgId,
      clientId,
      userId,
      type: "NOTE_ADDED",
      title: "Note added",
      description: body.length > 120 ? body.substring(0, 120) + "…" : body,
      linkUrl: null,
      metadata: { noteId: note.id, isPinned },
    });
    return res.status(201).json(note);
  } catch (err: any) {
    return res.status(400).json({ message: sanitizeErrorMessage(err) });
  }
});

app.patch("/api/clients/:clientId/notes/:id", requireManagerOrAbove, async (req, res) => {
  try {
    const orgId = req.session.orgId!;
    const userId = req.session.userId!;
    const existing = await storage.getClientNoteById(req.params.id as string, orgId);
    if (!existing || existing.clientId !== req.params.clientId) {
      return res.status(404).json({ message: "Note not found" });
    }
    const user = await storage.getUserById(userId);
    if (existing.authorId !== userId && user?.role !== "ADMIN") {
      return res.status(403).json({ message: "Only the author or an admin can edit this note" });
    }

    const updates: Record<string, any> = {};
    if (typeof req.body?.body === "string") {
      const b = req.body.body.trim();
      if (!b) return res.status(400).json({ message: "Note body cannot be empty" });
      updates.body = b;
    }
    if (typeof req.body?.isPinned === "boolean") updates.isPinned = req.body.isPinned;

    const note = await storage.updateClientNote(req.params.id as string, orgId, updates);
    if (!note) return res.status(404).json({ message: "Note not found" });
    return res.json(note);
  } catch (err: any) {
    return res.status(400).json({ message: sanitizeErrorMessage(err) });
  }
});

app.delete("/api/clients/:clientId/notes/:id", requireManagerOrAbove, async (req, res) => {
  try {
    const orgId = req.session.orgId!;
    const userId = req.session.userId!;
    const existing = await storage.getClientNoteById(req.params.id as string, orgId);
    if (!existing || existing.clientId !== req.params.clientId) {
      return res.status(404).json({ message: "Note not found" });
    }
    const user = await storage.getUserById(userId);
    if (existing.authorId !== userId && user?.role !== "ADMIN") {
      return res.status(403).json({ message: "Only the author or an admin can delete this note" });
    }
    const deleted = await storage.deleteClientNote(req.params.id as string, orgId);
    if (!deleted) return res.status(404).json({ message: "Note not found" });
    await storage.deleteClientActivitiesByNote(req.params.id as string, orgId);
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

// ============================================================
// Client Activity timeline
// ============================================================
app.get("/api/clients/:clientId/activities", requireAuth, async (req, res) => {
  try {
    const limit = Math.min(req.query.limit ? Number(req.query.limit) : 50, 200);
    const offset = req.query.offset ? Number(req.query.offset) : 0;
    const typesParam = typeof req.query.types === "string" ? req.query.types.split(",").filter(Boolean) : undefined;
    const activities = await storage.getClientActivitiesByClient(
      req.params.clientId as string,
      req.session.orgId!,
      { limit, offset, types: typesParam }
    );
    return res.json(activities);
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});
app.delete("/api/clients/:clientId/activities/:activityId", requireManagerOrAbove, async (req, res) => {
  try {
    const orgId = req.session.orgId!;
    const clientId = req.params.clientId as string;
    const activityId = req.params.activityId as string;
    const existing = await storage.getClientActivityById(activityId, orgId);
    if (!existing || existing.clientId !== clientId) {
      return res.status(404).json({ message: "Activity not found" });
    }
    const deleted = await storage.deleteClientActivity(activityId, orgId);
    if (!deleted) return res.status(404).json({ message: "Activity not found" });
    return res.status(204).end();
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

app.post("/api/clients/:clientId/activities", requireManagerOrAbove, async (req, res) => {
  try {
    const orgId = req.session.orgId!;
    const userId = req.session.userId!;
    const clientId = req.params.clientId as string;
    const client = await storage.getClientById(clientId, orgId);
    if (!client) return res.status(404).json({ message: "Client not found" });
    const type = typeof req.body?.type === "string" ? req.body.type.trim() : "";
    const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
    if (!type || !title) {
      return res.status(400).json({ message: "type and title are required" });
    }
    const description = typeof req.body?.description === "string" ? req.body.description.trim() : null;
    const linkUrl = typeof req.body?.linkUrl === "string" ? req.body.linkUrl.trim() : null;
    const metadata = req.body?.metadata && typeof req.body.metadata === "object" ? req.body.metadata : null;
    const row = await storage.createClientActivity({
      orgId,
      clientId,
      userId,
      type,
      title,
      description,
      linkUrl,
      metadata,
    });
    return res.status(201).json(row);
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

app.get("/api/public/portal/:token", async (req, res) => {
  try {
    const token = req.params.token as string;
    if (!token || token.length !== 64) {
      return res.status(404).json({ message: "Not found" });
    }
    const result = await storage.getClientPortalData(token);
    if (!result) {
      return res.status(404).json({ message: "Not found" });
    }
    return res.json(result);
  } catch {
    return res.status(500).json({ message: "Internal error" });
  }
});
}
