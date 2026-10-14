import { create } from "zustand";

const COLLAPSED_KEY = "fms-sidebar-collapsed";

// The desktop sidebar's icon-rail choice is a per-browser convenience; storage can be blocked, so never throw.
function readCollapsed(): boolean {
  try {
    return typeof window !== "undefined" && window.localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

interface UIState {
  /** Desktop sidebar shrunk to an icon rail. */
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (collapsed: boolean) => void;
  sidebarOpen: boolean;
  notificationDrawerOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  setNotificationDrawerOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  toggleNotificationDrawer: () => void;
}

export const useUIStore = create<UIState>((set) => ({
  sidebarCollapsed: readCollapsed(),
  setSidebarCollapsed: (collapsed) => {
    try { window.localStorage.setItem(COLLAPSED_KEY, collapsed ? "1" : "0"); } catch { /* not persisted */ }
    set({ sidebarCollapsed: collapsed });
  },
  sidebarOpen: false,
  notificationDrawerOpen: false,
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  setNotificationDrawerOpen: (open) => set({ notificationDrawerOpen: open }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  toggleNotificationDrawer: () =>
    set((s) => ({ notificationDrawerOpen: !s.notificationDrawerOpen })),
}));
