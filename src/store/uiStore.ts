import { create } from "zustand";

interface UIState {
  sidebarOpen: boolean;
  notificationDrawerOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  setNotificationDrawerOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  toggleNotificationDrawer: () => void;
}

export const useUIStore = create<UIState>((set) => ({
  sidebarOpen: false,
  notificationDrawerOpen: false,
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  setNotificationDrawerOpen: (open) => set({ notificationDrawerOpen: open }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  toggleNotificationDrawer: () =>
    set((s) => ({ notificationDrawerOpen: !s.notificationDrawerOpen })),
}));
