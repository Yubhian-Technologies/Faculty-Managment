"use client";

import { useEffect } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { auth } from "@/lib/firebase/client";
import { getUserById } from "@/lib/firestore/users";
import { useAuthStore } from "@/store/authStore";

export function useAuth() {
  const { user, isLoading, setUser, setLoading, setFirebaseToken, logout } =
    useAuthStore();

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      if (!firebaseUser) {
        logout();
        return;
      }

      try {
        const token = await firebaseUser.getIdToken();
        setFirebaseToken(token);

        // Fetch user profile from Firestore — role + collegeId come from custom claims
        const idTokenResult = await firebaseUser.getIdTokenResult();
        const role = idTokenResult.claims.role as string | undefined;
        const collegeId = idTokenResult.claims.collegeId as string | undefined;

        if (role === "SUPER_ADMIN") {
          setUser({
            uid: firebaseUser.uid,
            collegeId: "",
            name: firebaseUser.displayName ?? "Super Admin",
            email: firebaseUser.email ?? "",
            role: "SUPER_ADMIN",
            isActive: true,
            createdAt: {} as never,
          });
        } else if (collegeId && role) {
          const profile = await getUserById(collegeId, firebaseUser.uid);
          setUser(profile);
        } else {
          // No custom claims set — deny access
          await signOut(auth);
          logout();
        }
      } catch {
        logout();
      } finally {
        setLoading(false);
      }
    });

    return unsub;
  }, [logout, setFirebaseToken, setLoading, setUser]);

  const logoutUser = async () => {
    await signOut(auth);
    logout();
  };

  return { user, isLoading, logout: logoutUser };
}
