"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuthStore } from "@/store/authStore";
import { collegeFetch } from "@/lib/api/collegeFetch";
import type { AppNotification } from "@/types";

// Polled only while the tab is visible, and caught up the moment it becomes visible again:
// a hidden tab nobody is reading was most of the load, with no visible difference to anyone.
const POLL_INTERVAL = 60_000; // 60 seconds

export function useNotifications() {
  const user = useAuthStore((s) => s.user);
  const selectedCollegeId = useAuthStore((s) => s.selectedCollegeId);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    // College-scoped roles carry session.collegeId; GLOBAL roles (FINANCE,
    // PURCHASE_DEPT, MANAGEMENT) need a college picked via CollegeSwitcher.
    if (!user?.uid || (!user?.collegeId && !selectedCollegeId)) {
      // Drop the previous user's list so it never shows under a different login.
      setNotifications([]);
      setUnreadCount(0);
      setLoading(false);
      return;
    }
    try {
      const res = await collegeFetch("/api/college/notifications");
      if (!res.ok) return;
      const data = await res.json() as { notifications: AppNotification[] };
      const notifs = data.notifications ?? [];
      setNotifications(notifs);
      setUnreadCount(notifs.filter((n) => !n.read).length);
    } catch {
      // non-fatal - notifications are a nice-to-have
    } finally {
      setLoading(false);
    }
  }, [user?.uid, user?.collegeId, selectedCollegeId]);

  useEffect(() => {
    void load();
    const id = setInterval(() => { if (document.visibilityState === "visible") void load(); }, POLL_INTERVAL);
    const onVisible = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", onVisible); };
  }, [load]);

  const markRead = async (notificationId: string) => {
    setNotifications((prev) =>
      prev.map((n) => n.id === notificationId ? { ...n, read: true } : n)
    );
    setUnreadCount((c) => Math.max(0, c - 1));
    await collegeFetch("/api/college/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: notificationId }),
    });
  };

  const markAllRead = async () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnreadCount(0);
    await collegeFetch("/api/college/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ markAll: true }),
    });
  };

  return { notifications, unreadCount, loading, markRead, markAllRead };
}
