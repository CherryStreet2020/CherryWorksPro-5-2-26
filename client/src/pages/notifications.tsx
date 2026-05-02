import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Bell, CheckCheck, Circle, ExternalLink, Trash2, Filter, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PageBreadcrumbs } from "@/components/page-breadcrumbs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { RefreshCw } from "lucide-react";

interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  read: boolean;
  link?: string;
  createdAt: string;
  readAt: string | null;
}

interface NotificationsResponse {
  success: boolean;
  count: number;
  unreadCount: number;
  notifications: Notification[];
  supportedTypes: string[];
}

const TYPE_LABELS: Record<string, string> = {
  "invoice.paid": "Invoice Paid",
  "timesheet.submitted": "Timesheet",
  "mention": "Mention",
  "system": "System",
  "payment.failed": "Payment Failed",
  "budget.alert": "Budget Alert",
};

const TYPE_COLORS: Record<string, string> = {
  "invoice.paid": "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  "timesheet.submitted": "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  "mention": "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  "system": "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200",
  "payment.failed": "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  "budget.alert": "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
};

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export default function NotificationsPage() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [typeFilter, setTypeFilter] = useState<string>("all");

  const queryKey = ["/api/notifications", typeFilter === "all" ? "" : typeFilter];
  const queryUrl = typeFilter === "all" ? "/api/notifications" : `/api/notifications?type=${typeFilter}`;

  const { data, isLoading, dataUpdatedAt, isFetching } = useQuery<NotificationsResponse>({
    queryKey,
    queryFn: async () => {
      const res = await fetch(queryUrl, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch notifications");
      return res.json();
    },
    refetchOnWindowFocus: true,
  });

  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 10000);
    return () => clearInterval(id);
  }, []);

  const markReadMutation = useMutation({
    mutationFn: async (notifId: string) => {
      await apiRequest("POST", `/api/notifications/${notifId}/read`);
    },
    onMutate: async (notifId: string) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<NotificationsResponse>(queryKey);
      if (previous) {
        queryClient.setQueryData<NotificationsResponse>(queryKey, {
          ...previous,
          unreadCount: Math.max(0, previous.unreadCount - 1),
          notifications: previous.notifications.map((n) =>
            n.id === notifId ? { ...n, read: true, readAt: new Date().toISOString() } : n,
          ),
        });
      }
      return { previous };
    },
    onError: (_err, _notifId, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKey, context.previous);
      }
      toast({ title: "Error", description: "Failed to mark as read", variant: "destructive" });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] });
    },
  });

  const markAllReadMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/notifications/mark-all-read");
    },
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<NotificationsResponse>(queryKey);
      if (previous) {
        queryClient.setQueryData<NotificationsResponse>(queryKey, {
          ...previous,
          unreadCount: 0,
          notifications: previous.notifications.map((n) => ({
            ...n,
            read: true,
            readAt: n.readAt || new Date().toISOString(),
          })),
        });
      }
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKey, context.previous);
      }
      toast({ title: "Error", description: "Failed to mark all as read", variant: "destructive" });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (notifId: string) => {
      await apiRequest("DELETE", `/api/notifications/${notifId}`);
    },
    onMutate: async (notifId: string) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<NotificationsResponse>(queryKey);
      if (previous) {
        const removed = previous.notifications.find((n) => n.id === notifId);
        queryClient.setQueryData<NotificationsResponse>(queryKey, {
          ...previous,
          count: previous.count - 1,
          unreadCount: removed && !removed.read ? previous.unreadCount - 1 : previous.unreadCount,
          notifications: previous.notifications.filter((n) => n.id !== notifId),
        });
      }
      return { previous };
    },
    onError: (_err, _notifId, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKey, context.previous);
      }
      toast({ title: "Error", description: "Failed to delete notification", variant: "destructive" });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] });
    },
  });

  const notifications = data?.notifications ?? [];
  const unreadCount = data?.unreadCount ?? 0;

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6" data-testid="notifications-page">
      <PageBreadcrumbs group="Personal" page="Notifications" />
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Bell className="w-6 h-6 text-primary" />
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold" data-testid="text-notifications-title">Notifications</h1>
              {unreadCount > 0 && (
                <Badge variant="destructive" data-testid="badge-unread-count">
                  {unreadCount} unread
                </Badge>
              )}
            </div>
            {dataUpdatedAt > 0 && (
              <p className="text-[11px] mt-0.5" style={{ color: "var(--lux-text-muted)" }} data-testid="text-last-updated">
                Last updated {timeAgo(new Date(dataUpdatedAt).toISOString())}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            disabled={isFetching}
            onClick={() => queryClient.invalidateQueries({ queryKey: ["/api/notifications"] })}
            data-testid="button-refresh-notifications"
          >
            <RefreshCw className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-[180px]" data-testid="select-type-filter">
              <Filter className="w-4 h-4 mr-2" />
              <SelectValue placeholder="Filter by type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              {Object.entries(TYPE_LABELS).map(([key, label]) => (
                <SelectItem key={key} value={key}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {unreadCount > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => markAllReadMutation.mutate()}
              disabled={markAllReadMutation.isPending}
              data-testid="button-mark-all-read"
            >
              <CheckCheck className="w-4 h-4 mr-1" />
              Mark all read
            </Button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-lg" />
          ))}
        </div>
      ) : notifications.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Bell className="w-12 h-12 text-muted-foreground mb-3" />
            <p className="text-lg font-medium" data-testid="text-no-notifications">No notifications</p>
            <p className="text-sm text-muted-foreground">You're all caught up!</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {notifications.map((notif) => (
            <Card
              key={notif.id}
              className={`transition-colors ${notif.read ? "opacity-70" : "border-l-4 border-l-primary"}`}
              data-testid={`card-notification-${notif.id}`}
            >
              <CardContent className="flex items-start gap-4 py-4 px-5">
                <div className="mt-1">
                  {!notif.read && (
                    <Circle className="w-2.5 h-2.5 fill-primary text-primary" data-testid={`icon-unread-${notif.id}`} />
                  )}
                  {notif.read && <div className="w-2.5 h-2.5" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-semibold text-sm" data-testid={`text-notif-title-${notif.id}`}>{notif.title}</span>
                    <Badge
                      variant="secondary"
                      className={`text-[10px] px-1.5 py-0 ${TYPE_COLORS[notif.type] || ""}`}
                      data-testid={`badge-type-${notif.id}`}
                    >
                      {TYPE_LABELS[notif.type] || notif.type}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground" data-testid={`text-notif-message-${notif.id}`}>{notif.message}</p>
                  <p className="text-xs text-muted-foreground mt-1" data-testid={`text-notif-time-${notif.id}`}>{timeAgo(notif.createdAt)}</p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {notif.link && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => navigate(notif.link!)}
                      data-testid={`button-go-${notif.id}`}
                    >
                      <ExternalLink className="w-4 h-4" />
                    </Button>
                  )}
                  {!notif.read && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => markReadMutation.mutate(notif.id)}
                      disabled={markReadMutation.isPending}
                      data-testid={`button-mark-read-${notif.id}`}
                    >
                      <CheckCheck className="w-4 h-4" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive hover:text-destructive"
                    onClick={() => deleteMutation.mutate(notif.id)}
                    disabled={deleteMutation.isPending}
                    data-testid={`button-delete-${notif.id}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
