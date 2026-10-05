"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Eye } from "lucide-react";
import { useAuthStore } from "@/store/authStore";
import { isAllowedReadOnlyPage } from "@/lib/auth/readOnlyAccess";

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

  return (
    <div>
      {banner}
      <div className="rounded-lg border bg-background p-6 text-sm">
        <p className="font-medium">This page isn&apos;t available with read-only access.</p>
        <p className="mt-1 text-muted-foreground">You can still view:</p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li><Link href="/panel/profile" className="text-primary hover:underline">My profile</Link></li>
          <li><Link href="/panel/attendance" className="text-primary hover:underline">My attendance history</Link></li>
          <li><Link href="/panel/leave" className="text-primary hover:underline">My leave history</Link></li>
        </ul>
      </div>
    </div>
  );
}
