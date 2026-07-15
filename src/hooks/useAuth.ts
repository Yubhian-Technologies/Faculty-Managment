"use client";

import { useEffect } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { auth } from "@/lib/firebase/client";
import { getUserById } from "@/lib/firestore/users";
import { useAuthStore } from "@/store/authStore";
import type { FMSUser, UserRole } from "@/types";
import { LOCATION_SCOPED_ROLES, ROLE_SCOPE } from "@/types";

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
        let serverProfile: FMSUser | null = null;
        let serverName: string | undefined;
        let serverEmail: string | undefined;

        // Users created via REST API have no JWT custom claims.
        // Call session API (uses Admin SDK, bypasses Firestore rules) to resolve role.
        let locationId: string | undefined;
        if (!role) {
          try {
            const res = await fetch("/api/auth/session", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ token }),
            });
            if (res.ok) {
              const data = await res.json() as {
                role?: string; collegeId?: string; locationId?: string;
                name?: string; email?: string; profile?: FMSUser;
              };
              role = data.role && data.role !== "UNKNOWN" ? data.role : undefined;
              collegeId = data.collegeId;
              locationId = data.locationId;
              serverName = data.name;
              serverEmail = data.email;
              serverProfile = data.profile ?? null;
            }
          } catch { /* non-fatal */ }
        }

        if (role === "SUPER_ADMIN") {
          setUser({
            uid: firebaseUser.uid,
            collegeId: "",
            name: serverName ?? firebaseUser.displayName ?? "Super Admin",
            email: serverEmail ?? firebaseUser.email ?? "",
            role: "SUPER_ADMIN",
            isActive: true,
            createdAt: {} as never,
          });
        } else if (role && ROLE_SCOPE[role as UserRole] === "GLOBAL") {
          // MANAGEMENT, FINANCE, PURCHASE_DEPT — global, no college/location scope.
          setUser({
            uid: firebaseUser.uid,
            collegeId: "",
            name: serverName ?? firebaseUser.displayName ?? "User",
            email: serverEmail ?? firebaseUser.email ?? "",
            role: role as UserRole,
            isActive: true,
            createdAt: {} as never,
          });
        } else if (role && (LOCATION_SCOPED_ROLES as string[]).includes(role)) {
          // Location-scoped users have collegeId: "" — do NOT gate on collegeId.
          setUser(
            serverProfile ?? {
              uid: firebaseUser.uid,
              collegeId: "",
              locationId: locationId ?? "",
              name: serverName ?? firebaseUser.displayName ?? "User",
              email: serverEmail ?? firebaseUser.email ?? "",
              role: role as UserRole,
              isActive: true,
              createdAt: {} as never,
            }
          );
        } else if (collegeId && role) {
          // Server already fetched the profile for claim-less users.
          // For users with JWT claims, try client-side Firestore fetch.
          let profile: FMSUser | null = serverProfile;
          if (!profile) {
            try {
              profile = await getUserById(collegeId, firebaseUser.uid);
            } catch { /* blocked by security rules — use fallback below */ }
          }
          setUser(
            profile ?? {
              uid: firebaseUser.uid,
              collegeId,
              name: serverName ?? firebaseUser.displayName ?? "User",
              email: serverEmail ?? firebaseUser.email ?? "",
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
