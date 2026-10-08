"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useAuthStore } from "@/store/authStore";
import { useWorkContextStore } from "@/store/workContextStore";


import {
  ACTIVE_LOCATION_DEPT_COOKIE,
  encodeActiveLocationDept,
} from "@/lib/location/activeLocationDept";
import type { LocationDepartment } from "@/types/locationStaff";

export function syncActiveLocationDeptCookie(uid: string, deptId: string | null | undefined) {
  if (typeof document === "undefined") return;
  document.cookie = deptId
    ? `${ACTIVE_LOCATION_DEPT_COOKIE}=${encodeActiveLocationDept(uid, deptId)}; path=/; max-age=31536000; SameSite=Lax`
    : `${ACTIVE_LOCATION_DEPT_COOKIE}=; path=/; max-age=0; SameSite=Lax`;
}

export function useActiveLocationDept() {
  const user = useAuthStore((s) => s.user);
  const chosen = useWorkContextStore((s) => (user ? s.chosen[`loc_dept_${user.uid}`] : undefined));
  const choose = useWorkContextStore((s) => s.choose);

  const [departments, setDepartments] = useState<LocationDepartment[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Fetch departments available to this user
  useEffect(() => {
    let isCancelled = false;
    if (!user || !user.locationId) {
      Promise.resolve().then(() => {
        if (!isCancelled) {
          setDepartments([]);
          setIsLoading(false);
        }
      });
      return () => {
        isCancelled = true;
      };
    }
    fetch(`/api/location/departments`)
      .then((res) => (res.ok ? res.json() : Promise.resolve({ departments: [] })))
      .then((data: { departments?: LocationDepartment[] }) => {
        if (!isCancelled) {
          const list = data.departments ?? [];
          setDepartments(list);
        }
      })
      .catch(() => {
        if (!isCancelled) setDepartments([]);
      })
      .finally(() => {
        if (!isCancelled) setIsLoading(false);
      });

    return () => {
      isCancelled = true;
    };
  }, [user]);

  // Depts this user heads (if LOCATION_DEPT_HEAD) or all (if admin)
  const myDepartments = useMemo(() => {
    if (!user) return [];
    if (user.role === "LOCATION_DEPT_HEAD") {
      const uEmail = user.email?.trim().toLowerCase();
      const uDeptIds = user.locationDeptIds ?? [];
      const uSingleDeptId = user.locationDeptId;

      return departments.filter((d) => {
        if (d.headUid && d.headUid === user.uid) return true;
        if (d.deptHeadUid && d.deptHeadUid === user.uid) return true;
        if (uDeptIds.includes(d.id)) return true;
        if (uSingleDeptId && uSingleDeptId === d.id) return true;
        if (d.headEmail && uEmail && d.headEmail.trim().toLowerCase() === uEmail) return true;
        return false;
      });
    }
    return [];
  }, [departments, user]);

  // Active department ID
  const activeDeptId = useMemo(() => {
    if (myDepartments.length === 0) return null;
    if (chosen && myDepartments.some((d) => d.id === chosen)) {
      return chosen;
    }
    return myDepartments[0]?.id ?? null;
  }, [myDepartments, chosen]);

  const activeDept = useMemo(() => {
    return myDepartments.find((d) => d.id === activeDeptId) ?? null;
  }, [myDepartments, activeDeptId]);

  const setActiveDeptId = useCallback(
    (deptId: string) => {
      if (!user) return;
      choose(`loc_dept_${user.uid}`, deptId);
      syncActiveLocationDeptCookie(user.uid, deptId);
    },
    [user, choose]
  );

  useEffect(() => {
    if (user?.uid && activeDeptId) {
      syncActiveLocationDeptCookie(user.uid, activeDeptId);
    }
  }, [user?.uid, activeDeptId]);

  return {
    departments,
    myDepartments,
    activeDeptId,
    activeDept,
    setActiveDeptId,
    hasMultipleDepts: myDepartments.length > 1,
    isLoading,
  };
}
