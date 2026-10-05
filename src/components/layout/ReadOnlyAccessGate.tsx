"use client";

import { usePathname } from "next/navigation";
import { Eye } from "lucide-react";
import { useAuthStore } from "@/store/authStore";
import { isAllowedReadOnlyPage } from "@/lib/auth/readOnlyAccess";
import { ReadOnlyHome } from "@/components/layout/ReadOnlyHome";

/**
 * Wraps the dashboard content. For everyone except a RESIGNED/RETIRED faculty
 * member (user.readOnlyAccess, derived server-side from facultyMembers.status),
 * this renders its children untouched. For them it shows a "read-only access"
 * notice and only lets the profile / attendance history / leave history pages
 * through; every other page is replaced by a short explanation instead of a wall
 * of failed requests. The server is the authority (the API guards deny every
 * write and every other read) - this only keeps the screen honest.
 */
export function ReadOnlyAccessGate({ children }: { children: React.ReactNode }) {
  const readOnly = useAuthStore((s) => s.user?.readOnlyAccess === true);
  const pathname = usePathname();

  if (!readOnly) return <>{children}</>;

  const banner = (
    <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900" data-testid="read-only-banner">
      <Eye className="mt-0.5 h-4 w-4 shrink-0" />
      <p>
        <strong>Read-only access.</strong> You are no longer an active faculty member, so you can view your own profile,
        attendance history and leave history, but you cannot make any changes.
      </p>
    </div>
  );

  if (isAllowedReadOnlyPage(pathname)) {
    return (<>{banner}{children}</>);
  }

  // Anything else - including their own dashboard, where they land after signing in - becomes a short
  // welcome that says why access is limited and links to the three places they can still open.
  return <ReadOnlyHome blockedPath={pathname} />;
}
