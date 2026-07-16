import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { FMSUser } from "@/types";
import { LOCATION_SCOPED_ROLES } from "@/types";

interface AuthState {
  user: FMSUser | null;
  firebaseToken: string | null;
  isLoading: boolean;
  // Global roles (FINANCE, PURCHASE_DEPT) carry no collegeId of their own — they
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
      setUser: (user) => set({ user }),
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
