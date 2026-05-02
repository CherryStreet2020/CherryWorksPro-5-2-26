import type { Express, Request, Response } from "express";
import { requireAuth } from "./middleware";

interface Shortcut {
  id: string; keys: string; keysDisplay: string;
  action: string; description: string;
  category: "navigation" | "actions" | "search" | "help";
  enabled: boolean;
}

const SHORTCUTS: Shortcut[] = [
  { id: "go-invoices", keys: "g+i", keysDisplay: "G then I", action: "navigate:/invoices", description: "Go to Invoices", category: "navigation", enabled: true },
  { id: "go-clients", keys: "g+c", keysDisplay: "G then C", action: "navigate:/clients", description: "Go to Clients", category: "navigation", enabled: true },
  { id: "go-timesheets", keys: "g+t", keysDisplay: "G then T", action: "navigate:/timesheets", description: "Go to Timesheets", category: "navigation", enabled: true },
  { id: "go-reports", keys: "g+r", keysDisplay: "G then R", action: "navigate:/reports", description: "Go to Reports", category: "navigation", enabled: true },
  { id: "new-item", keys: "n", keysDisplay: "N", action: "modal:new-item", description: "Create new item", category: "actions", enabled: true },
  { id: "search-focus", keys: "/", keysDisplay: "/", action: "focus:search", description: "Focus search bar", category: "search", enabled: true },
  { id: "cmd-k", keys: "mod+k", keysDisplay: "⌘K / Ctrl+K", action: "modal:command-palette", description: "Open command palette", category: "search", enabled: true },
  { id: "shortcuts-help", keys: "?", keysDisplay: "?", action: "modal:shortcuts-cheatsheet", description: "Show keyboard shortcuts", category: "help", enabled: true },
  { id: "go-dashboard", keys: "g+d", keysDisplay: "G then D", action: "navigate:/", description: "Go to Dashboard", category: "navigation", enabled: true },
  { id: "go-expenses", keys: "g+e", keysDisplay: "G then E", action: "navigate:/expenses", description: "Go to Expenses", category: "navigation", enabled: true },
  { id: "go-settings", keys: "g+s", keysDisplay: "G then S", action: "navigate:/settings", description: "Go to Settings", category: "navigation", enabled: true },
  { id: "escape", keys: "Escape", keysDisplay: "Esc", action: "close:modal", description: "Close modal/dialog", category: "actions", enabled: true },
];

interface UserShortcutPrefs { userId: string; orgId: string; disabled: string[]; customBindings: Record<string, string>; }
const userPrefs = new Map<string, UserShortcutPrefs>();

export function registerKeyboardShortcutsRoutes(app: Express) {
  app.get("/api/keyboard-shortcuts", requireAuth, (req: Request, res: Response) => {
    const key = `${req.session.orgId}:${req.session.userId}`;
    const prefs = userPrefs.get(key);
    const disabled = prefs?.disabled || [];

    const shortcuts = SHORTCUTS.map((s) => ({
      ...s, enabled: !disabled.includes(s.id),
      keys: prefs?.customBindings[s.id] || s.keys,
    }));

    const byCategory: Record<string, any[]> = {};
    for (const s of shortcuts) { if (!byCategory[s.category]) byCategory[s.category] = []; byCategory[s.category].push(s); }

    res.json({ success: true, count: shortcuts.length, shortcuts, byCategory, categories: ["navigation", "actions", "search", "help"] });
  });

  app.get("/api/keyboard-shortcuts/cheatsheet", (_req: Request, res: Response) => {
    const byCategory: Record<string, any[]> = {};
    for (const s of SHORTCUTS) { if (!byCategory[s.category]) byCategory[s.category] = []; byCategory[s.category].push({ keys: s.keysDisplay, description: s.description }); }

    res.json({
      success: true, title: "Keyboard Shortcuts",
      sections: [
        { title: "Navigation", shortcuts: byCategory["navigation"] || [] },
        { title: "Actions", shortcuts: byCategory["actions"] || [] },
        { title: "Search", shortcuts: byCategory["search"] || [] },
        { title: "Help", shortcuts: byCategory["help"] || [] },
      ],
      totalShortcuts: SHORTCUTS.length,
    });
  });

  app.put("/api/keyboard-shortcuts/preferences", requireAuth, (req: Request, res: Response) => {
    const { disabled, customBindings } = req.body;
    const key = `${req.session.orgId}:${req.session.userId}`;
    let prefs = userPrefs.get(key);
    if (!prefs) prefs = { userId: req.session.userId!, orgId: req.session.orgId!, disabled: [], customBindings: {} };
    if (Array.isArray(disabled)) prefs.disabled = disabled;
    if (customBindings && typeof customBindings === "object") prefs.customBindings = { ...prefs.customBindings, ...customBindings };
    userPrefs.set(key, prefs);
    res.json({ success: true, preferences: prefs });
  });

  app.post("/api/keyboard-shortcuts/preferences/reset", requireAuth, (req: Request, res: Response) => {
    const key = `${req.session.orgId}:${req.session.userId}`;
    userPrefs.delete(key);
    res.json({ success: true, reset: true, shortcuts: SHORTCUTS });
  });

  app.post("/api/keyboard-shortcuts/execute", requireAuth, (req: Request, res: Response) => {
    const { shortcutId } = req.body;
    if (!shortcutId) return res.status(400).json({ error: "shortcutId required" });
    const shortcut = SHORTCUTS.find((s) => s.id === shortcutId);
    if (!shortcut) return res.status(404).json({ error: "Shortcut not found" });

    const key = `${req.session.orgId}:${req.session.userId}`;
    const prefs = userPrefs.get(key);
    if (prefs?.disabled.includes(shortcutId)) return res.status(400).json({ error: "Shortcut is disabled" });

    const [actionType, actionTarget] = shortcut.action.split(":");
    res.json({ success: true, executed: true, shortcut: { id: shortcut.id, keys: shortcut.keysDisplay }, result: { type: actionType, target: actionTarget } });
  });
}
