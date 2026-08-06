"use client";

import { useEffect } from "react";
import { onIdTokenChanged, signOut } from "firebase/auth";
import { auth } from "@/lib/firebase/client";
import { getUserById } from "@/lib/firestore/users";
import { useAuthStore } from "@/store/authStore";
import type { FMSUser, UserRole } from "@/types";
import { LOCATION_SCOPED_ROLES, ROLE_SCOPE } from "@/types";

export function useAuth() {
  const { user, isLoading, setUser, setLoading, setFirebaseToken, logout } =
    useAuthStore();

  useEffect(() => {
    // onIdTokenChanged (not onAuthStateChanged) - it also re-fires whenever
    // the Firebase SDK silently refreshes the ID token in the background
    // (roughly hourly), which is what lets the block below keep the
    // server-side fms-session cookie's embedded expiry current for as long
    // as the client stays signed in.
    const unsub = onIdTokenChanged(auth, async (firebaseUser) => {
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
        let locationId = idTokenResult.claims.locationId as string | undefined;
        let serverProfile: FMSUser | null = null;
        let serverName: string | undefined;
        let serverEmail: string | undefined;

        // Users created via REST API have no JWT custom claims.
        // Call session API (uses Admin SDK, bypasses Firestore rules) to resolve role.
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
        } else {
          // Role already resolved from JWT claims, so the fast path below
          // never touches /api/auth/session - but that route is also what
          // (re)sets the httpOnly fms-session cookie, and that cookie's
          // embedded `exp` is the Firebase ID token's own ~1h expiry, not a
          // fixed 24h one. Without this, the cookie goes stale ~1h after
          // login and every server route starts 401ing while the client
          // still looks signed in. Fire-and-forget: just refreshes the
          // cookie, doesn't affect local state.
          fetch("/api/auth/session", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token }),
          }).catch(() => {});
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
          // MANAGEMENT, FINANCE, PURCHASE_DEPT - global, no college/location scope.
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
          // Location-scoped users have collegeId: "" - do NOT gate on collegeId.
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
            } catch { /* blocked by security rules - use fallback below */ }
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
