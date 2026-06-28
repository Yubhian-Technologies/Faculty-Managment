"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signInWithEmailAndPassword } from "firebase/auth";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Eye, EyeOff } from "lucide-react";
import { auth } from "@/lib/firebase/client";
import { getUserById } from "@/lib/firestore/users";
import { loginSchema, type LoginFormData } from "@/lib/validations";
import { ROLE_DASHBOARD_PATHS } from "@/types";
import type { FMSUser, UserRole } from "@/types";
import { useAuthStore } from "@/store/authStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { toast } from "@/hooks/useToast";

const FIREBASE_ERROR_MESSAGES: Record<string, string> = {
  "auth/invalid-credential": "Invalid email or password. Please try again.",
  "auth/user-disabled": "This account has been disabled. Contact your administrator.",
  "auth/too-many-requests": "Too many failed attempts. Please try again later.",
  "auth/network-request-failed": "Network error. Please check your connection.",
  "auth/user-not-found": "No account found with this email.",
  "auth/wrong-password": "Incorrect password.",
};

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirect = searchParams.get("redirect");
  const { setUser, setFirebaseToken } = useAuthStore();
  const [showPassword, setShowPassword] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
  });

  const onSubmit = async (data: LoginFormData) => {
    try {
      const credential = await signInWithEmailAndPassword(
        auth,
        data.email,
        data.password
      );

      const token = await credential.user.getIdToken();
      setFirebaseToken(token);

      // Set session cookie — the server resolves role/collegeId from JWT claims
      // or from the Firestore systemUsers collection (for users created without claims)
      const sessionRes = await fetch("/api/auth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (!sessionRes.ok) {
        const errBody = await sessionRes.json() as { error?: string; detail?: string };
        throw new Error(`Session error: ${errBody.detail ?? errBody.error ?? sessionRes.status}`);
      }

      const sessionData = await sessionRes.json() as {
        ok: boolean;
        role?: string;
        collegeId?: string;
        locationId?: string;
        name?: string;
        email?: string;
        profile?: FMSUser;
      };
      const role = sessionData.role ?? "";
      const collegeId = sessionData.collegeId ?? "";
      const locationId = sessionData.locationId ?? "";

      if (!role || role === "UNKNOWN") {
        throw new Error("Account not configured. Contact your administrator.");
      }

      const LOCATION_ROLES = ["ADMINISTRATION", "HR_ADMIN", "ADMIN_OFFICE", "LOCATION_DEPT_HEAD"];

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
      } else if (LOCATION_ROLES.includes(role) && locationId) {
        // Location-scoped role — profile comes from locations/{id}/locationUsers/{uid}
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
          } catch { /* blocked by Firestore rules — use session data fallback */ }
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
    } catch (err: unknown) {
      const code = (err as { code?: string }).code ?? "";
      const message =
        FIREBASE_ERROR_MESSAGES[code] ??
        (err instanceof Error ? err.message : "Sign in failed. Please try again.");

      toast({
        variant: "destructive",
        title: "Sign in failed",
        description: message,
      });
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
      <div className="w-full max-w-md space-y-6">
        {/* Logo */}
        <div className="text-center">
          <div className="flex justify-center mb-4">
            <img src="https://res.cloudinary.com/dl88qtudz/image/upload/v1781675822/vishnulogo_r2jsjl.png" alt="Vishnu Logo" className="h-20 w-20 object-contain" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">Vishnu People</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Sign in to continue to your dashboard
          </p>
        </div>

        {/* Login Card */}
        <Card className="shadow-xl border-0">
          <CardHeader className="space-y-1 pb-4">
            <CardTitle className="text-xl">Welcome back</CardTitle>
            <CardDescription>Enter your credentials to access Vishnu People</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
              <div className="space-y-2">
                <Label htmlFor="email">Email address</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@college.edu"
                  autoComplete="email"
                  autoFocus
                  {...register("email")}
                  aria-invalid={!!errors.email}
                />
                {errors.email && (
                  <p className="text-sm text-destructive">{errors.email.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="Enter your password"
                    autoComplete="current-password"
                    {...register("password")}
                    aria-invalid={!!errors.password}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
                {errors.password && (
                  <p className="text-sm text-destructive">{errors.password.message}</p>
                )}
              </div>

              <Button
                type="submit"
                className="w-full"
                size="lg"
                loading={isSubmitting}
              >
                {isSubmitting ? "Signing in..." : "Sign in"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          Having trouble signing in? Contact your college administrator.
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center">
        <div className="h-8 w-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      <LoginForm />
    </Suspense>
  );
}
