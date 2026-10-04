"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signInWithEmailAndPassword, type UserCredential } from "firebase/auth";
import { Eye, EyeOff } from "lucide-react";
import { auth } from "@/lib/firebase/client";
import { getUserById } from "@/lib/firestore/users";
import { ROLE_DASHBOARD_PATHS, LOCATION_SCOPED_ROLES, ROLE_SCOPE } from "@/types";
import type { FMSUser, UserRole } from "@/types";
import { useAuthStore } from "@/store/authStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { toast } from "@/hooks/useToast";

import { studentLoginEmail } from "@/lib/students/loginDefaults";

const FIREBASE_ERROR_MESSAGES: Record<string, string> = {
  "auth/invalid-credential": "Invalid username or password. Please try again.",
  "auth/user-disabled": "This account has been disabled. Contact your administrator.",
  "auth/too-many-requests": "Too many failed attempts. Please try again later.",
  "auth/network-request-failed": "Network error. Please check your connection.",
  "auth/user-not-found": "No account found with this username or email.",
  "auth/wrong-password": "Incorrect password.",
};

// Shared continuation once Firebase Auth accepts the credential - resolving
// role/collegeId/profile and redirecting to the right dashboard is identical
// whether the caller signed in as staff (email) or a student (resolved
// synthetic email).
async function completeLogin(
  credential: UserCredential,
  redirect: string | null,
  router: ReturnType<typeof useRouter>,
  setUser: (user: FMSUser | null) => void,
  setFirebaseToken: (token: string | null) => void
) {
  const token = await credential.user.getIdToken();
  setFirebaseToken(token);

  // Set session cookie - the server resolves role/collegeId from JWT claims
  // or from the Firestore systemUsers collection (for users created without claims)
  const sessionRes = await fetch("/api/auth/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  if (!sessionRes.ok) {
    const errBody = (await sessionRes.json()) as { error?: string; detail?: string };
    throw new Error(`Session error: ${errBody.detail ?? errBody.error ?? sessionRes.status}`);
  }

  const sessionData = (await sessionRes.json()) as {
    ok: boolean;
    role?: string;
    collegeId?: string;
    locationId?: string;
    name?: string;
    email?: string;
    profile?: FMSUser;
    refreshToken?: boolean;
  };

  // Server just backfilled custom claims - force a token refresh so the new
  // claims are included in the client's Firebase Auth token. This makes
  // client-side Firestore security rules work on first login.
  if (sessionData.refreshToken) {
    try {
      await credential.user.getIdToken(true);
    } catch {
      /* non-fatal */
    }
  }
  const role = sessionData.role ?? "";
  const collegeId = sessionData.collegeId ?? "";
  const locationId = sessionData.locationId ?? "";

  if (!role || role === "UNKNOWN") {
    throw new Error("Account not configured. Contact your administrator.");
  }

  const LOCATION_ROLES = LOCATION_SCOPED_ROLES as string[];

  if (role === "SUPER_ADMIN") {
    setUser({
      uid: credential.user.uid,
      collegeId: "",
      name: sessionData.name ?? credential.user.displayName ?? "Admin",
      email: sessionData.email ?? credential.user.email ?? "",
      role: "SUPER_ADMIN",
      isActive: true,
      createdAt: {} as never,
    });
    router.push(redirect ?? "/super-admin");
  } else if (ROLE_SCOPE[role as UserRole] === "GLOBAL") {
    // MANAGEMENT, FINANCE, PURCHASE_DEPT - global roles with no college/location
    // scope. Their profile lives only in systemUsers; act on colleges via an
    // explicit college context chosen inside the dashboard.
    setUser({
      uid: credential.user.uid,
      collegeId: "",
      name: sessionData.name ?? credential.user.displayName ?? "User",
      email: sessionData.email ?? credential.user.email ?? "",
      role: role as UserRole,
      isActive: true,
      createdAt: {} as never,
    });
    router.push(redirect ?? ROLE_DASHBOARD_PATHS[role as UserRole] ?? "/login");
  } else if (LOCATION_ROLES.includes(role) && locationId) {
    // Location-scoped role - profile comes from locations/{id}/locationUsers/{uid}
    const profile: FMSUser = sessionData.profile ?? {
      uid: credential.user.uid,
      collegeId: "",
      locationId,
      name: sessionData.name ?? credential.user.displayName ?? "User",
      email: sessionData.email ?? credential.user.email ?? "",
      role: role as UserRole,
      isActive: true,
      createdAt: {} as never,
    };
    setUser(profile);
    const dashboardPath = ROLE_DASHBOARD_PATHS[profile.role] ?? "/administration";
    router.push(redirect ?? dashboardPath);
  } else if (collegeId) {
    // Server already fetched the profile via Admin SDK (bypasses Firestore rules).
    // Fall back to client-side fetch for users with proper JWT custom claims.
    let profile: FMSUser | null = sessionData.profile ?? null;
    if (!profile) {
      try {
        profile = await getUserById(collegeId, credential.user.uid);
      } catch {
        /* blocked by Firestore rules - use session data fallback */
      }
    }
    if (!profile) {
      profile = {
        uid: credential.user.uid,
        collegeId,
        locationId,
        name: sessionData.name ?? credential.user.displayName ?? "User",
        email: sessionData.email ?? credential.user.email ?? "",
        role: role as UserRole,
        isActive: true,
        createdAt: {} as never,
      };
    }
    setUser(profile);
    const dashboardPath = ROLE_DASHBOARD_PATHS[profile.role] ?? "/hod";
    router.push(redirect ?? dashboardPath);
  } else {
    throw new Error("Account not configured. Contact your administrator.");
  }
}

function loginFailureMessage(err: unknown): string {
  const code = (err as { code?: string }).code ?? "";
  return (
    FIREBASE_ERROR_MESSAGES[code] ?? (err instanceof Error ? err.message : "Sign in failed. Please try again.")
  );
}

// Single, plain-looking form for both staff and students - no mode switch,
// no college picker, and nothing on screen names "Roll Number" specifically.
// The identifier field auto-routes purely on its own shape: containing "@"
// signs in directly as a staff email; anything else is resolved server-side
// (across every college - see resolve-student-login/route.ts) to a student's
// real (synthetic) sign-in email(s) and tried with the password typed (see
// lib/students/loginDefaults.ts).
function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirect = searchParams.get("redirect");
  const { setUser, setFirebaseToken } = useAuthStore();

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isEmail = identifier.includes("@");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!identifier.trim() || !password) {
      toast({ variant: "destructive", title: "Sign in failed", description: "Both fields are required." });
      return;
    }

    setIsSubmitting(true);
    try {
      let credential: UserCredential;

      if (isEmail) {
        // Staff/Admin direct email sign-in
        credential = await signInWithEmailAndPassword(auth, identifier.trim(), password);
      } else {
        // Student Roll Number sign-in:
        // 1. Try the deterministic Auth email: <rollNumber>@students.internal
        //    (no database read) - the identity for any plain roll (letters/digits).
        const directEmail = studentLoginEmail(identifier.trim());
        try {
          credential = await signInWithEmailAndPassword(auth, directEmail, password);
        } catch (directErr: unknown) {
          // 2. Otherwise ask the backend which email(s) this roll belongs to
          //    (rolls with punctuation or different formatting, changed rolls) and
          //    try each with the password typed. Roll numbers are globally unique,
          //    so this is at most the roll's normalised and legacy emails.
          const errCode = (directErr as { code?: string })?.code;
          if (errCode !== "auth/user-not-found" && errCode !== "auth/invalid-credential") throw directErr;

          const resolveRes = await fetch("/api/auth/resolve-student-login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ rollNumber: identifier.trim() }),
          });
          if (resolveRes.status === 429) {
            throw Object.assign(new Error("Too many attempts. Please wait a minute and try again."), { code: "auth/too-many-requests" });
          }
          const resolveBody = (await resolveRes.json().catch(() => ({}))) as { loginEmail?: string; loginEmails?: string[] };
          const candidates = (resolveBody.loginEmails ?? (resolveBody.loginEmail ? [resolveBody.loginEmail] : []))
            .filter((email) => email && email !== directEmail);
          if (!resolveRes.ok || candidates.length === 0) throw directErr;

          let signedIn: UserCredential | null = null;
          let lastErr: unknown = directErr;
          for (const email of candidates) {
            try {
              signedIn = await signInWithEmailAndPassword(auth, email, password);
              break;
            } catch (candidateErr) {
              lastErr = candidateErr;
              // A rate-limit or disabled account is not "wrong candidate" - stop and say so.
              const code = (candidateErr as { code?: string })?.code;
              if (code === "auth/too-many-requests" || code === "auth/user-disabled") throw candidateErr;
            }
          }
          if (!signedIn) throw lastErr;
          credential = signedIn;
        }
      }

      await completeLogin(credential, redirect, router, setUser, setFirebaseToken);
    } catch (err: unknown) {
      toast({ variant: "destructive", title: "Sign in failed", description: loginFailureMessage(err) });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
      <div className="w-full max-w-md space-y-6">
        {/* Logo */}
        <div className="text-center">
          <div className="flex justify-center mb-4">
            <img src="https://res.cloudinary.com/dl88qtudz/image/upload/v1781675822/vishnulogo_r2jsjl.png" alt="Vishnu Logo" className="h-20 w-20 object-contain" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">Vishnu People</h1>
          <p className="text-sm text-muted-foreground mt-1">Sign in to continue to your dashboard</p>
        </div>

        {/* Login Card */}
        <Card className="shadow-xl border-0">
          <CardHeader className="space-y-1 pb-4">
            <CardTitle className="text-xl">Welcome back</CardTitle>
            <CardDescription>Enter your email or roll number to sign in</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="space-y-4" noValidate>
              <div className="space-y-2">
                <Label htmlFor="identifier">Username</Label>
                <Input
                  id="identifier"
                  type="text"
                  placeholder="Email or Roll Number"
                  autoComplete="username"
                  autoFocus
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  suppressHydrationWarning
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="Enter your password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pr-10"
                    suppressHydrationWarning
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    suppressHydrationWarning
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <Button type="submit" className="w-full" size="lg" loading={isSubmitting} suppressHydrationWarning>
                {isSubmitting ? "Signing in..." : "Sign in"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground">Having trouble signing in? Contact your college administrator.</p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <div className="h-8 w-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
