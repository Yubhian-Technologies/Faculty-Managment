"use client";

import { useEffect, useState } from "react";
import {
  collection,
  query,
  where,
  onSnapshot,
  updateDoc,
  doc,
} from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { useAuthStore } from "@/store/authStore";
import type { AppNotification } from "@/types";

export function useNotifications() {
  const user = useAuthStore((s) => s.user);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.uid || !user?.collegeId) {
      setLoading(false);
      return;
    }

    const ref = collection(db, "colleges", user.collegeId, "notifications");
    // Single-field where() avoids the composite index requirement.
    // Sort and slice client-side until the index is deployed.
    const q = query(ref, where("toUid", "==", user.uid));

    const unsub = onSnapshot(q, (snap) => {
      const notifs = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }) as AppNotification)
        .sort((a, b) => {
          const at = a.createdAt?.toMillis?.() ?? 0;
          const bt = b.createdAt?.toMillis?.() ?? 0;
          return bt - at;
        })
        .slice(0, 30);
      setNotifications(notifs);
      setUnreadCount(notifs.filter((n) => !n.read).length);
      setLoading(false);
    });

    return unsub;
  }, [user?.uid, user?.collegeId]);

  const markRead = async (notificationId: string) => {
    if (!user?.collegeId) return;
    const ref = doc(
      db,
      "colleges",
      user.collegeId,
      "notifications",
      notificationId
    );
    await updateDoc(ref, { read: true });
  };

  const markAllRead = async () => {
    await Promise.all(
      notifications.filter((n) => !n.read).map((n) => markRead(n.id))
    );
  };

  return { notifications, unreadCount, loading, markRead, markAllRead };
}
