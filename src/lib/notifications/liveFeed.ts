import { collection, limit, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { collegeFetch } from "@/lib/api/collegeFetch";
import type { AppNotification } from "@/types";

// Live notifications. Instead of every open tab asking the server "anything new?" every minute,
// a Firestore listener on the person's own notifications (rules already let a signed-in user read
// documents addressed to their uid) is pushed new ones as they are written - by notify() and the
// approvals engine - so the bell updates within a second and an idle tab costs nothing.
//
// One listener is shared by every component that shows notifications (the top-bar badge and the
// drawer). If the listener can't run (offline, blocked network, permission error) the feed falls back
// to the previous behaviour - a 60s poll of /api/college/notifications while the tab is visible - so
// notifications never silently stop.

const FALLBACK_POLL_MS = 60_000;
const LIMIT = 30;

type Handler = (items: AppNotification[]) => void;
interface Feed {
  handlers: Set<Handler>;
  last: AppNotification[] | null;
  stop: () => void;
}
const feeds = new Map<string, Feed>();

function startFeed(collegeId: string, uid: string, feed: Feed): () => void {
  const emit = (items: AppNotification[]) => {
    feed.last = items;
    feed.handlers.forEach((h) => h(items));
  };

  let unsubscribe: (() => void) | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let onVisible: (() => void) | null = null;

  const poll = async () => {
    try {
      const res = await collegeFetch("/api/college/notifications");
      if (!res.ok) return;
      const data = (await res.json()) as { notifications?: AppNotification[] };
      emit(data.notifications ?? []);
    } catch {
      // non-fatal - notifications are a nice-to-have
    }
  };
  const startPolling = () => {
    if (pollTimer || typeof document === "undefined") return;
    void poll();
    pollTimer = setInterval(() => { if (document.visibilityState === "visible") void poll(); }, FALLBACK_POLL_MS);
    onVisible = () => { if (document.visibilityState === "visible") void poll(); };
    document.addEventListener("visibilitychange", onVisible);
  };

  try {
    const q = query(
      collection(db, "colleges", collegeId, "notifications"),
      where("toUid", "==", uid),
      orderBy("createdAt", "desc"),
      limit(LIMIT),
    );
    unsubscribe = onSnapshot(
      q,
      (snap) => emit(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as AppNotification)),
      () => {
        unsubscribe?.();
        unsubscribe = null;
        startPolling();
      },
    );
  } catch {
    startPolling();
  }

  return () => {
    unsubscribe?.();
    if (pollTimer) clearInterval(pollTimer);
    if (onVisible) document.removeEventListener("visibilitychange", onVisible);
  };
}

/** Subscribes to this person's notifications; returns the unsubscribe function. */
export function subscribeToNotifications(collegeId: string, uid: string, handler: Handler): () => void {
  const key = `${collegeId}/${uid}`;
  let feed = feeds.get(key);
  if (!feed) {
    feed = { handlers: new Set(), last: null, stop: () => {} };
    feeds.set(key, feed);
    feed.stop = startFeed(collegeId, uid, feed);
  }
  feed.handlers.add(handler);
  if (feed.last) handler(feed.last);

  const owner = feed;
  return () => {
    owner.handlers.delete(handler);
    if (owner.handlers.size === 0) {
      owner.stop();
      feeds.delete(key);
    }
  };
}
