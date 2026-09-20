import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { FMSUser } from "@/types";
import { LOCATION_SCOPED_ROLES } from "@/types";

interface AuthState {
  user: FMSUser | null;
  firebaseToken: string | null;
  isLoading: boolean;
  // Global roles (FINANCE, PURCHASE_DEPT) carry no collegeId of their own - they
  // act on whichever college is picked here via the CollegeSwitcher. Ignored by
  // college-scoped roles, whose session already carries a fixed collegeId.
  selectedCollegeId: string | null;
  setUser: (user: FMSUser | null) => void;
  setFirebaseToken: (token: string | null) => void;
  setLoading: (loading: boolean) => void;
  setSelectedCollegeId: (collegeId: string | null) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      firebaseToken: null,
      isLoading: true,
      selectedCollegeId: null,
      // selectedCollegeId is persisted to localStorage so a GLOBAL role
      // (FINANCE/PURCHASE_DEPT) remembers its chosen college across page
      // reloads - but that persistence was keyed only to the browser, not to
      // WHICH account is signed in. If the same device signs in as a
      // different account without an explicit logout() in between (logout()
      // already clears it), the new session silently inherited whatever
      // college the previous one had picked, and every /api/college/* call
      // that falls back to it (see collegeFetch's withCollegeId) - including
      // the notification bell - would show that unrelated, possibly
      // long-stale college's data instead of nothing. Reset it whenever the
      // incoming user is a different uid than whoever was signed in before;
      // keep it when it's the same uid (an ordinary reload/token refresh).
      setUser: (user) =>
        set((state) => ({
          user,
          selectedCollegeId:
            user && state.user && user.uid === state.user.uid
              ? state.selectedCollegeId
              : null,
        })),
      setFirebaseToken: (firebaseToken) => set({ firebaseToken }),
      setLoading: (isLoading) => set({ isLoading }),
      setSelectedCollegeId: (selectedCollegeId) => set({ selectedCollegeId }),
      logout: () => set({ user: null, firebaseToken: null, isLoading: false, selectedCollegeId: null }),
    }),
    {
      name: "fms-auth",
      partialize: (state) => ({ user: state.user, selectedCollegeId: state.selectedCollegeId }),
    }
  )
);

export function isLocationRole(role: string | undefined): boolean {
  return (LOCATION_SCOPED_ROLES as string[]).includes(role ?? "");
}
