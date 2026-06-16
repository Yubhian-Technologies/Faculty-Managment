import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { FMSUser } from "@/types";

interface AuthState {
  user: FMSUser | null;
  firebaseToken: string | null;
  isLoading: boolean;
  setUser: (user: FMSUser | null) => void;
  setFirebaseToken: (token: string | null) => void;
  setLoading: (loading: boolean) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      firebaseToken: null,
      isLoading: true,
      setUser: (user) => set({ user }),
      setFirebaseToken: (firebaseToken) => set({ firebaseToken }),
      setLoading: (isLoading) => set({ isLoading }),
      logout: () => set({ user: null, firebaseToken: null, isLoading: false }),
    }),
    {
      name: "fms-auth",
      partialize: (state) => ({ user: state.user }),
    }
  )
);
