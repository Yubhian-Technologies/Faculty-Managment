"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuthStore } from "@/store/authStore";
import { collegeFetch } from "@/lib/api/collegeFetch";
import { subscribeToNotifications } from "@/lib/notifications/liveFeed";
import { hidePanelPrompts } from "@/lib/notifications/visibility";
import type { AppNotification } from "@/types";

export function useNotifications() {
  const user = useAuthStore((s) => s.user);
  const selectedCollegeId = useAuthStore((s) => s.selectedCollegeId);
  const [feed, setFeed] = useState<AppNotification[]>([]);
  const [read, setRead] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  // College-scoped roles carry user.collegeId; GLOBAL roles (FINANCE, PURCHASE_DEPT, MANAGEMENT)
  // need a college picked via CollegeSwitcher.
  const collegeId = user?.collegeId || selectedCollegeId || "";
  const uid = user?.uid ?? "";

  useEffect(() => {
    // Drop the previous user's list so it never shows under a different login.
    setFeed([]);
    setRead(new Set());
    if (!uid || !collegeId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    return subscribeToNotifications(collegeId, uid, (items) => {
      setFeed(items);
      setLoading(false);
    });
  }, [uid, collegeId]);

  // `read` holds ids marked read locally before the live feed echoes the server change back.
  const notifications = useMemo(
    () => hidePanelPrompts(user?.role, feed).map((n) => (read.has(n.id) ? { ...n, read: true } : n)),
    [feed, read, user?.role],
  );
  const unreadCount = useMemo(() => notifications.filter((n) => !n.read).length, [notifications]);

  // A read-only person (RESIGNED/RETIRED faculty) can see their notifications but cannot change anything -
  // marking one read is a write the server refuses, so do not pretend it worked (and do not send it).
  const readOnly = user?.readOnlyAccess === true;

  const markRead = async (notificationId: string) => {
    if (readOnly) return;
    setRead((prev) => new Set(prev).add(notificationId));
    await collegeFetch("/api/college/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: notificationId }),
    });
  };

  const markAllRead = async () => {
    if (readOnly) return;
    setRead(new Set(feed.map((n) => n.id)));
    await collegeFetch("/api/college/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ markAll: true }),
    });
  };

  return { notifications, unreadCount, loading, markRead, markAllRead };
}
