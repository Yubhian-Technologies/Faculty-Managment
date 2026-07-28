"use client";

import { useRouter } from "next/navigation";
import { Bell, X } from "lucide-react";
import { formatDateTime } from "@/lib/utils";
import { useNotifications } from "@/hooks/useNotifications";
import { useNotificationPopupStore } from "@/store/notificationPopupStore";
import { Button } from "@/components/ui/button";

// Reusable, module-agnostic login popup for actionable workflow
// notifications (src/lib/notifications/workflowNotifications.ts). Not
// specific to Budget or any other domain — anything that emits an
// `actionable` AppNotification shows up here until it's resolved.
export function ActionableNotificationPopup() {
  const router = useRouter();
  const { actionablePending, markRead } = useNotifications();
  const { dismissedIds, dismiss } = useNotificationPopupStore();

  const visible = actionablePending.filter((n) => !dismissedIds.has(n.id));
  if (visible.length === 0) return null;

  function handleAction(id: string, link?: string) {
    void markRead(id);
    if (link) router.push(link);
  }

  return (
    <div className="fixed bottom-4 right-4 z-[60] flex w-[calc(100vw-2rem)] max-w-md flex-col gap-2 sm:w-96">
      {visible.map((n) => (
        <div
          key={n.id}
          className="flex items-start gap-3 rounded-lg border bg-background p-4 shadow-lg animate-in slide-in-from-bottom-2"
        >
          <div className="mt-0.5 shrink-0 rounded-full bg-primary/10 p-2">
            <Bell className="h-4 w-4 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium leading-snug">{n.title}</p>
            <p className="mt-0.5 text-sm text-muted-foreground leading-snug">{n.message}</p>
            <div className="mt-2 flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{formatDateTime(n.createdAt)}</span>
              {n.link && (
                <Button size="sm" className="h-7 px-2.5 text-xs" onClick={() => handleAction(n.id, n.link)}>
                  View
                </Button>
              )}
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0 -mt-1 -mr-1"
            onClick={() => dismiss(n.id)}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}
    </div>
  );
}
