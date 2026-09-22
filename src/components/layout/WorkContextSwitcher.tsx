"use client";

import { useRouter } from "next/navigation";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuthStore } from "@/store/authStore";
import { useWorkContextStore } from "@/store/workContextStore";
import { syncActiveHodCookie, useWorkContext } from "@/hooks/useWorkContext";
import { ROLE_DASHBOARD_PATHS, type UserRole } from "@/types/core";
import { departmentOfContext } from "@/lib/roles/activeHodDepartment";

// "Working as ..." - only for logins that hold seats. Picking one changes the
// sidebar to that seat's modules (or the person's own, for "My Work") and opens
// its dashboard.
export function WorkContextSwitcher() {
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
    router.push(ROLE_DASHBOARD_PATHS[role as UserRole] ?? "/");
  }

  return (
    <div className="px-3 pt-3 shrink-0">
      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest px-1 pb-1">Working as</p>
      <Select value={active} onValueChange={onChange}>
        <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
        <SelectContent>
          {contexts.map((c) => <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}
