"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, ChevronDown, MapPin, Building2, Building } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/store/authStore";
import type { College, Location, Department } from "@/types";

// Sidebar Location -> College -> Department scope tree, rendered by Sidebar.tsx
// for both FINANCE and PURCHASE_DEPT — both are GLOBAL roles with no fixed
// college, so every /api/college/* call they make needs an explicit collegeId
// (see CollegeSwitcher.tsx). Replaces the old header "current college"
// indicator + its link out to a separate browse page: the whole org tree now
// lives in the sidebar directly so scope can be picked (and department-level
// views opened) without leaving the page.

interface CollegesByLocation {
  [locationId: string]: College[] | undefined;
}

interface DepartmentsByCollege {
  [collegeId: string]: Department[] | undefined;
}

interface OrgScopeTreeProps {
  collegeHref: (locationId: string, collegeId: string) => string;
  departmentHref: (locationId: string, collegeId: string, departmentName: string) => string;
}

export function OrgScopeTree({ collegeHref, departmentHref }: OrgScopeTreeProps) {
  const router = useRouter();
  const selectedCollegeId = useAuthStore((s) => s.selectedCollegeId);
  const setSelectedCollegeId = useAuthStore((s) => s.setSelectedCollegeId);

  const [locations, setLocations] = useState<Location[]>([]);
  const [collegesByLocation, setCollegesByLocation] = useState<CollegesByLocation>({});
  const [departmentsByCollege, setDepartmentsByCollege] = useState<DepartmentsByCollege>({});
  const [openLocations, setOpenLocations] = useState<Set<string>>(new Set());
  const [openColleges, setOpenColleges] = useState<Set<string>>(new Set());
  const [loadingColleges, setLoadingColleges] = useState<Set<string>>(new Set());
  const [loadingDepartments, setLoadingDepartments] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch("/api/admin/locations")
      .then((r) => r.json() as Promise<{ locations: Location[] }>)
      .then((d) => setLocations(d.locations ?? []))
      .catch(() => {});
  }, []);

  const toggleLocation = (locationId: string) => {
    setOpenLocations((prev) => {
      const next = new Set(prev);
      if (next.has(locationId)) {
        next.delete(locationId);
      } else {
        next.add(locationId);
        if (!collegesByLocation[locationId]) {
          setLoadingColleges((l) => new Set(l).add(locationId));
          fetch(`/api/admin/colleges?locationId=${locationId}`)
            .then((r) => r.json() as Promise<{ colleges: College[] }>)
            .then((d) => setCollegesByLocation((prevMap) => ({ ...prevMap, [locationId]: d.colleges ?? [] })))
            .catch(() => setCollegesByLocation((prevMap) => ({ ...prevMap, [locationId]: [] })))
            .finally(() => setLoadingColleges((l) => { const n = new Set(l); n.delete(locationId); return n; }));
        }
      }
      return next;
    });
  };

  const toggleCollege = (collegeId: string) => {
    setOpenColleges((prev) => {
      const next = new Set(prev);
      if (next.has(collegeId)) {
        next.delete(collegeId);
      } else {
        next.add(collegeId);
        if (!departmentsByCollege[collegeId]) {
          setLoadingDepartments((l) => new Set(l).add(collegeId));
          fetch(`/api/management/colleges/${collegeId}/departments`)
            .then((r) => r.json() as Promise<{ departments: Department[] }>)
            .then((d) => setDepartmentsByCollege((prevMap) => ({ ...prevMap, [collegeId]: d.departments ?? [] })))
            .catch(() => setDepartmentsByCollege((prevMap) => ({ ...prevMap, [collegeId]: [] })))
            .finally(() => setLoadingDepartments((l) => { const n = new Set(l); n.delete(collegeId); return n; }));
        }
      }
      return next;
    });
  };

  const goToCollege = (locationId: string, collegeId: string) => {
    setSelectedCollegeId(collegeId);
    router.push(collegeHref(locationId, collegeId));
  };

  const goToDepartment = (locationId: string, collegeId: string, departmentName: string) => {
    setSelectedCollegeId(collegeId);
    router.push(departmentHref(locationId, collegeId, departmentName));
  };

  return (
    <div className="px-3 py-2">
      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest px-3 pb-1">
        Browse Scope
      </p>
      <div className="space-y-0.5">
        {locations.map((loc) => {
          const isLocationOpen = openLocations.has(loc.id);
          const colleges = collegesByLocation[loc.id];
          return (
            <div key={loc.id}>
              <button
                onClick={() => toggleLocation(loc.id)}
                className="flex items-center gap-2 w-full px-3 py-1.5 rounded-md text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              >
                {isLocationOpen ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
                <MapPin className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{loc.name}</span>
              </button>

              {isLocationOpen && (
                <div className="ml-4 border-l pl-2 space-y-0.5">
                  {loadingColleges.has(loc.id) && (
                    <p className="px-3 py-1 text-xs text-muted-foreground">Loading…</p>
                  )}
                  {colleges?.length === 0 && (
                    <p className="px-3 py-1 text-xs text-muted-foreground">No colleges</p>
                  )}
                  {colleges?.map((college) => {
                    const isCollegeOpen = openColleges.has(college.id);
                    const departments = departmentsByCollege[college.id];
                    const isSelected = selectedCollegeId === college.id;
                    return (
                      <div key={college.id}>
                        <div
                          className={cn(
                            "flex items-center gap-1 rounded-md text-xs transition-colors",
                            isSelected ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                          )}
                        >
                          <button
                            onClick={() => toggleCollege(college.id)}
                            className="p-1.5 shrink-0"
                          >
                            {isCollegeOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                          </button>
                          <button
                            onClick={() => goToCollege(loc.id, college.id)}
                            className="flex items-center gap-1.5 flex-1 min-w-0 py-1.5 pr-2 text-left"
                          >
                            <Building2 className="h-3.5 w-3.5 shrink-0" />
                            <span className="truncate">{college.name}</span>
                          </button>
                        </div>

                        {isCollegeOpen && (
                          <div className="ml-5 border-l pl-2 space-y-0.5">
                            {loadingDepartments.has(college.id) && (
                              <p className="px-3 py-1 text-xs text-muted-foreground">Loading…</p>
                            )}
                            {departments?.length === 0 && (
                              <p className="px-3 py-1 text-xs text-muted-foreground">No departments</p>
                            )}
                            {departments?.map((dept) => (
                              <button
                                key={dept.id}
                                onClick={() => goToDepartment(loc.id, college.id, dept.name)}
                                className="flex items-center gap-1.5 w-full px-3 py-1.5 rounded-md text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors text-left"
                              >
                                <Building className="h-3 w-3 shrink-0" />
                                <span className="truncate">{dept.name}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
