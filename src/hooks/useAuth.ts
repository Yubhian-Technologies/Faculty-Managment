"use client";

import { useEffect } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase/client";
import { getUserById } from "@/lib/firestore/users";
import { useAuthStore } from "@/store/authStore";
import type { UserRole } from "@/types";

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

        const idTokenResult = await firebaseUser.getIdTokenResult();
        let role = idTokenResult.claims.role as string | undefined;
        let collegeId = idTokenResult.claims.collegeId as string | undefined;

        // Users created via REST API have no JWT custom claims.
        // Fall back to systemUsers Firestore collection.
        if (!role) {
          const sysSnap = await getDoc(doc(db, "systemUsers", firebaseUser.uid));
          if (sysSnap.exists()) {
            const sys = sysSnap.data() as { role?: string; collegeId?: string };
            role = sys.role;
            collegeId = sys.collegeId;
          }
        }

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
          // Try client-side Firestore fetch (works for users WITH custom claims).
          // For users without custom claims the rules block it — use minimal profile.
          let profile = null;
          try {
            profile = await getUserById(collegeId, firebaseUser.uid);
          } catch { /* blocked by security rules — handled below */ }

          setUser(
            profile ?? {
              uid: firebaseUser.uid,
              collegeId,
              name: firebaseUser.displayName ?? "User",
              email: firebaseUser.email ?? "",
              role: role as UserRole,
              isActive: true,
              createdAt: {} as never,
            }
          );
        } else {
          // Genuinely no account configured
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
