"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuthStore } from "@/store/authStore";
import type { AppNotification } from "@/types";

const POLL_INTERVAL = 30_000; // 30 seconds

export function useNotifications() {
  const user = useAuthStore((s) => s.user);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user?.uid || !user?.collegeId) { setLoading(false); return; }
    try {
      const res = await fetch("/api/college/notifications");
      if (!res.ok) return;
      const data = await res.json() as { notifications: AppNotification[] };
      const notifs = data.notifications ?? [];
      setNotifications(notifs);
      setUnreadCount(notifs.filter((n) => !n.read).length);
    } catch {
      // non-fatal — notifications are a nice-to-have
    } finally {
      setLoading(false);
    }
  }, [user?.uid, user?.collegeId]);

  useEffect(() => {
    void load();
    const id = setInterval(() => { void load(); }, POLL_INTERVAL);
    return () => clearInterval(id);
  }, [load]);

  const markRead = async (notificationId: string) => {
    setNotifications((prev) =>
      prev.map((n) => n.id === notificationId ? { ...n, read: true } : n)
    );
    setUnreadCount((c) => Math.max(0, c - 1));
    await fetch("/api/college/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: notificationId }),
    });
  };

  const markAllRead = async () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnreadCount(0);
    await fetch("/api/college/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ markAll: true }),
    });
  };

  return { notifications, unreadCount, loading, markRead, markAllRead };
}
