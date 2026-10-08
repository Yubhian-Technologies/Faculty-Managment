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

type Handler = (items: AppNotification[]) => void;

// Notifications are currently PAUSED for cost optimization.
// Returning early prevents starting Firestore onSnapshot listeners or polling loops.
export function subscribeToNotifications(_collegeId: string, _uid: string, handler: Handler): () => void {
  handler([]);
  return () => {};
}
