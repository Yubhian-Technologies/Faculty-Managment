import { create } from "zustand";

// Deliberately NOT persisted (no `persist` middleware): dismissing a popup
// only hides it for the current session. A fresh login/page load starts with
// an empty set, so a still-pending actionable notification reappears next
// time — resolveWorkflowNotifications (server-side) is what makes it stop
// reappearing for good, once the linked workflow step is actually done.
interface NotificationPopupState {
  dismissedIds: Set<string>;
  dismiss: (id: string) => void;
}

export const useNotificationPopupStore = create<NotificationPopupState>((set) => ({
  dismissedIds: new Set(),
  dismiss: (id) =>
    set((s) => ({ dismissedIds: new Set(s.dismissedIds).add(id) })),
}));
