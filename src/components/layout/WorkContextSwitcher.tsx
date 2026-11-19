"use client";

import { useRouter } from "next/navigation";
import { Briefcase } from "lucide-react";
import { NAV_MUTED } from "./navTheme";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuthStore } from "@/store/authStore";
import { useWorkContextStore } from "@/store/workContextStore";
import { syncActiveHodCookie, useWorkContext } from "@/hooks/useWorkContext";
import { ROLE_DASHBOARD_PATHS, type UserRole } from "@/types/core";
import { departmentOfContext } from "@/lib/roles/activeHodDepartment";
import { dashboardPathFor } from "@/lib/auth/collegeAdminPaths";

// "Working as ..." - only for logins that hold seats. Picking one changes the
// sidebar to that seat's modules (or the person's own, for "My Work") and opens
// its dashboard.
// `compact` is the desktop sidebar's icon rail: only an icon, same menu.
export function WorkContextSwitcher({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const choose = useWorkContextStore((s) => s.choose);
  const { contexts, active } = useWorkContext();
  if (!user || contexts.length === 0 || !active) return null;

  function onChange(key: string) {
    if (!user) return;
    choose(user.uid, key);
    syncActiveHodCookie(user.uid, key);
    const role = key === "ME" ? user.role : departmentOfContext(key) !== null ? "HOD" : (key as UserRole);
    router.push((key === "ME" ? dashboardPathFor(user.role, user.realRole) : undefined) ?? ROLE_DASHBOARD_PATHS[role as UserRole] ?? "/");
  }

  if (compact) {
    const label = contexts.find((c) => c.key === active)?.label ?? "Working as";
    return (
      <div className="px-2 pt-3 shrink-0">
        <Select value={active} onValueChange={onChange}>
          <SelectTrigger className="h-10 w-full justify-center px-0 border-white/10 bg-white/[0.07] text-blue-200 hover:bg-white/[0.12] [&>svg:last-child]:hidden" title={`Working as: ${label}`} aria-label={`Working as: ${label}`}>
            <Briefcase className="h-4 w-4" />
            <span className="sr-only"><SelectValue /></span>
          </SelectTrigger>
          <SelectContent className="min-w-56">
            {contexts.map((c) => <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
    );
  }

  return (
    <div className="px-3 pt-1 shrink-0">
      <Select value={active} onValueChange={onChange}>
        <SelectTrigger className="h-auto py-2 pl-2 pr-2.5 gap-2.5 rounded-xl [&>span:first-child]:flex [&>span:last-of-type]:block border-white/10 bg-white/[0.07] text-white hover:bg-white/[0.11] [&>svg:last-child]:text-[#8fa0cc] [&>svg:last-child]:opacity-100">
          <span className="h-8 w-8 rounded-lg bg-blue-400/20 text-blue-200 flex items-center justify-center shrink-0">
            <Briefcase className="h-4 w-4" />
          </span>
          <span className="flex-1 min-w-0 text-left">
            <span className={`block text-[10.5px] leading-tight ${NAV_MUTED}`}>Working As</span>
            <span className="block truncate text-[13.5px] font-semibold leading-tight"><SelectValue /></span>
          </span>
        </SelectTrigger>
        <SelectContent>
          {contexts.map((c) => <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}
