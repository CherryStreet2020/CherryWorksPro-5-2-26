import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";
import {
  Users, FolderKanban, FileText, Clock, UserCheck, Search,
  LayoutDashboard, Receipt, BarChart3, BookOpen, User, Settings,
  UsersRound, FileCheck, Plus, History,
} from "lucide-react";
import { useAuth } from "@/lib/auth";

const ICONS: Record<string, typeof Users> = {
  client: Users,
  project: FolderKanban,
  invoice: FileText,
  timesheet: Clock,
  "team member": UserCheck,
};

interface SearchResult {
  type: string;
  id: string;
  label: string;
  sublabel: string;
  url: string;
}

interface RecentItem {
  label: string;
  url: string;
  icon: string;
  timestamp: number;
}

const NAV_ITEMS = [
  { label: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
  { label: "Clients", url: "/clients", icon: Users },
  { label: "Projects", url: "/projects", icon: FolderKanban },
  { label: "Estimates", url: "/estimates", icon: FileCheck },
  { label: "Invoices", url: "/invoices", icon: FileText },
  { label: "Expenses", url: "/expenses", icon: Receipt },
  { label: "Time Tracking", url: "/time", icon: Clock },
  { label: "Reports", url: "/reports", icon: BarChart3 },
  { label: "Chart of Accounts", url: "/gl/accounts", icon: BookOpen },
  { label: "Profile", url: "/profile", icon: User },
  { label: "Settings", url: "/settings", icon: Settings },
  { label: "Team", url: "/team", icon: UsersRound },
];

const CREATE_ITEMS = [
  { label: "New Client", url: "/clients?action=new", icon: Users },
  { label: "New Project", url: "/projects?action=new", icon: FolderKanban },
  { label: "New Estimate", url: "/estimates?action=new", icon: FileCheck },
  { label: "New Invoice", url: "/invoices?action=new", icon: FileText },
  { label: "New Time Entry", url: "/time?action=new", icon: Clock },
  { label: "New Expense", url: "/expenses?action=new", icon: Receipt },
];

const RECENT_KEY_PREFIX = "cwpro_recent_";
const MAX_RECENT = 5;

function getRecentItems(userId: string): RecentItem[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY_PREFIX + userId);
    if (!raw) return [];
    return JSON.parse(raw) as RecentItem[];
  } catch {
    return [];
  }
}

function addRecentItem(userId: string, item: Omit<RecentItem, "timestamp">) {
  try {
    const items = getRecentItems(userId);
    const filtered = items.filter((i) => i.url !== item.url);
    filtered.unshift({ ...item, timestamp: Date.now() });
    localStorage.setItem(
      RECENT_KEY_PREFIX + userId,
      JSON.stringify(filtered.slice(0, MAX_RECENT)),
    );
  } catch {}
}

const ICON_MAP: Record<string, typeof Users> = {
  LayoutDashboard,
  Users,
  FolderKanban,
  FileCheck,
  FileText,
  Receipt,
  Clock,
  BarChart3,
  BookOpen,
  User,
  Settings,
  UsersRound,
  Search,
};

function resolveIcon(name: string) {
  return ICON_MAP[name] || Search;
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const userId = user?.id || "anon";

  const [recentItems, setRecentItems] = useState<RecentItem[]>([]);

  useEffect(() => {
    if (open) {
      setRecentItems(getRecentItems(userId));
    }
  }, [open, userId]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  const search = useCallback(async (q: string) => {
    if (!q || q.length < 1) {
      setResults([]);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      if (res.ok) {
        const data = await res.json();
        setResults(data.results || []);
      }
    } catch {
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => search(query), 150);
    return () => clearTimeout(timer);
  }, [query, search]);

  const grouped = results.reduce<Record<string, SearchResult[]>>((acc, r) => {
    (acc[r.type] = acc[r.type] || []).push(r);
    return acc;
  }, {});

  function navigate(url: string, label: string, iconName: string) {
    addRecentItem(userId, { label, url, icon: iconName });
    setOpen(false);
    setQuery("");
    setLocation(url);
  }

  const hasQuery = query.length > 0;

  const filteredNav = hasQuery
    ? NAV_ITEMS.filter((n) =>
        n.label.toLowerCase().includes(query.toLowerCase()),
      )
    : NAV_ITEMS;

  const filteredCreate = hasQuery
    ? CREATE_ITEMS.filter((c) =>
        c.label.toLowerCase().includes(query.toLowerCase()),
      )
    : CREATE_ITEMS;

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput
        placeholder="Search or jump to..."
        value={query}
        onValueChange={setQuery}
        data-testid="search-input"
      />
      <CommandList className="max-h-[400px]">
        {!hasQuery && recentItems.length > 0 && (
          <CommandGroup heading="Recent" data-testid="command-group-recent">
            {recentItems.map((item) => {
              const Icon = resolveIcon(item.icon);
              return (
                <CommandItem
                  key={item.url}
                  value={`recent ${item.label}`}
                  onSelect={() => navigate(item.url, item.label, item.icon)}
                  data-testid={`command-recent-${item.label.replace(/\s+/g, "-").toLowerCase()}`}
                  className="min-h-[40px]"
                >
                  <History className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="flex flex-col flex-1">
                    <span className="text-sm">{item.label}</span>
                  </div>
                  <span className="text-[10px] text-muted-foreground ml-auto">
                    {timeAgo(item.timestamp)}
                  </span>
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}

        {filteredNav.length > 0 && (
          <CommandGroup heading="Navigation" data-testid="command-group-navigation">
            {filteredNav.map((item) => {
              const Icon = item.icon;
              return (
                <CommandItem
                  key={item.url}
                  value={`go to ${item.label}`}
                  onSelect={() => navigate(item.url, item.label, item.icon.displayName || item.icon.name || "Search")}
                  data-testid={`command-nav-${item.label.replace(/\s+/g, "-").toLowerCase()}`}
                  className="min-h-[40px]"
                >
                  <Icon className="mr-2 h-4 w-4 shrink-0" />
                  <span className="text-sm">{item.label}</span>
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}

        {filteredCreate.length > 0 && (
          <CommandGroup heading="Create" data-testid="command-group-create">
            {filteredCreate.map((item) => {
              const Icon = item.icon;
              return (
                <CommandItem
                  key={item.url}
                  value={`create ${item.label}`}
                  onSelect={() => navigate(item.url, item.label, item.icon.displayName || item.icon.name || "Search")}
                  data-testid={`command-create-${item.label.replace(/\s+/g, "-").toLowerCase()}`}
                  className="min-h-[40px]"
                >
                  <Plus className="mr-2 h-4 w-4 shrink-0 text-green-600" />
                  <span className="text-sm">{item.label}</span>
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}

        {hasQuery && (filteredNav.length > 0 || filteredCreate.length > 0) && Object.keys(grouped).length > 0 && (
          <CommandSeparator />
        )}

        {loading && (
          <div className="py-6 text-center text-sm text-muted-foreground">
            Searching...
          </div>
        )}
        {!loading && hasQuery && results.length === 0 && filteredNav.length === 0 && filteredCreate.length === 0 && (
          <CommandEmpty>No results found.</CommandEmpty>
        )}
        {Object.entries(grouped).map(([type, items]) => {
          const Icon = ICONS[type] || Search;
          return (
            <CommandGroup
              key={type}
              heading={type.charAt(0).toUpperCase() + type.slice(1) + "s"}
            >
              {items.map((item) => (
                <CommandItem
                  key={item.id}
                  value={`${item.label} ${item.sublabel}`}
                  onSelect={() => navigate(item.url, item.label, "Search")}
                  data-testid={`search-result-${item.type}-${item.id}`}
                  className="min-h-[44px]"
                >
                  <Icon className="mr-2 h-4 w-4 shrink-0" />
                  <div className="flex flex-col">
                    <span className="text-sm font-medium">{item.label}</span>
                    {item.sublabel && (
                      <span className="text-xs text-muted-foreground">
                        {item.sublabel}
                      </span>
                    )}
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          );
        })}
      </CommandList>
      <div
        className="flex items-center justify-center gap-4 border-t px-3 py-2 text-[11px] text-muted-foreground"
        data-testid="command-keyboard-hints"
      >
        <span>
          <kbd className="inline-flex items-center justify-center rounded border bg-muted px-1 py-0.5 font-mono text-[10px]">↑</kbd>
          <kbd className="inline-flex items-center justify-center rounded border bg-muted px-1 py-0.5 font-mono text-[10px] ml-0.5">↓</kbd>
          <span className="ml-1">navigate</span>
        </span>
        <span>
          <kbd className="inline-flex items-center justify-center rounded border bg-muted px-1 py-0.5 font-mono text-[10px]">↵</kbd>
          <span className="ml-1">select</span>
        </span>
        <span>
          <kbd className="inline-flex items-center justify-center rounded border bg-muted px-1 py-0.5 font-mono text-[10px]">esc</kbd>
          <span className="ml-1">close</span>
        </span>
      </div>
    </CommandDialog>
  );
}
