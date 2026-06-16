"use client";

import { Bell, CheckCheck, X } from "lucide-react";
import { formatDateTime } from "@/lib/utils";
import { useNotifications } from "@/hooks/useNotifications";
import { useUIStore } from "@/store/uiStore";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function NotificationDrawer() {
  const { notificationDrawerOpen, setNotificationDrawerOpen } = useUIStore();
  const { notifications, unreadCount, markRead, markAllRead, loading } =
    useNotifications();

  return (
    <>
      {notificationDrawerOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/40"
          onClick={() => setNotificationDrawerOpen(false)}
        />
      )}
      <div
        className={cn(
          "fixed top-0 right-0 z-50 h-full w-full sm:w-96 bg-background border-l shadow-xl transition-transform duration-300 flex flex-col",
          notificationDrawerOpen ? "translate-x-0" : "translate-x-full"
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between h-16 px-4 border-b shrink-0">
          <div className="flex items-center gap-2">
            <Bell className="h-5 w-5 text-primary" />
            <h2 className="font-semibold">Notifications</h2>
            {unreadCount > 0 && (
              <span className="bg-primary text-primary-foreground text-xs rounded-full px-2 py-0.5">
                {unreadCount}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {unreadCount > 0 && (
              <Button variant="ghost" size="sm" onClick={markAllRead}>
                <CheckCheck className="h-4 w-4 mr-1" />
                Mark all read
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setNotificationDrawerOpen(false)}
            >
              <X className="h-5 w-5" />
            </Button>
          </div>
        </div>

        {/* Notifications list */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-8 text-center text-muted-foreground text-sm">Loading...</div>
          ) : notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 p-8 text-center">
              <Bell className="h-12 w-12 text-muted-foreground/30" />
              <p className="text-muted-foreground text-sm">No notifications yet</p>
            </div>
          ) : (
            <ul className="divide-y">
              {notifications.map((n) => (
                <li
                  key={n.id}
                  className={cn(
                    "p-4 cursor-pointer hover:bg-muted/40 transition-colors",
                    !n.read && "bg-primary/5 border-l-2 border-l-primary"
                  )}
                  onClick={() => !n.read && markRead(n.id)}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={cn(
                        "h-2 w-2 rounded-full mt-1.5 shrink-0",
                        n.read ? "bg-muted" : "bg-primary"
                      )}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium leading-snug">{n.title}</p>
                      <p className="text-sm text-muted-foreground mt-0.5 leading-snug">
                        {n.message}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1.5">
                        {formatDateTime(n.createdAt)}
                      </p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}
