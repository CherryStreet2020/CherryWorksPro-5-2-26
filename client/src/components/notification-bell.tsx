import { Bell } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";

interface UnreadCountResponse {
  success: boolean;
  unreadCount: number;
  hasBadge: boolean;
}

export function NotificationBell() {
  const [, navigate] = useLocation();
  const { data } = useQuery<UnreadCountResponse>({
    queryKey: ["/api/notifications/unread-count"],
    refetchInterval: 60000,
    refetchOnWindowFocus: true,
  });

  const unread = data?.unreadCount ?? 0;
  const display = unread > 99 ? "99+" : String(unread);

  return (
    <button
      onClick={() => navigate("/notifications")}
      className="relative w-8 h-8 rounded-full flex items-center justify-center cursor-pointer transition-colors hover:bg-accent"
      style={{ color: "var(--lux-text-secondary)" }}
      title={unread > 0 ? `${unread} unread notification${unread === 1 ? "" : "s"}` : "Notifications"}
      data-testid="button-header-notifications"
    >
      <Bell className="w-4 h-4" />
      {unread > 0 && (
        <span
          className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full text-[10px] font-semibold flex items-center justify-center text-white"
          style={{ background: "#cf3339" }}
          data-testid="badge-header-unread-count"
        >
          {display}
        </span>
      )}
    </button>
  );
}
