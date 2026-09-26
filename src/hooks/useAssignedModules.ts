import { useEffect, useState } from "react";
import { useAuthStore } from "@/store/authStore";
import type { FacultyAssignedModule } from "@/types";

export function useAssignedModules() {
  const user = useAuthStore((s) => s.user);
  const [modules, setModules] = useState<FacultyAssignedModule[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.collegeId || !user?.uid) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    fetch("/api/college/faculty/modules")
      .then((r) => r.json() as Promise<{ modules?: FacultyAssignedModule[] }>)
      .then((d) => { if (!cancelled) setModules(d.modules ?? []); })
      .catch(() => { if (!cancelled) setModules([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [user?.collegeId, user?.uid]);

  async function updateModules(next: FacultyAssignedModule[]) {
    const res = await fetch("/api/college/faculty/modules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ modules: next }),
    });
    if (res.ok) {
      const d = await res.json() as { modules: FacultyAssignedModule[] };
      setModules(d.modules);
    }
  }

  function hasModule(m: FacultyAssignedModule) {
    return modules.includes(m);
  }

  return { modules, loading, hasModule, updateModules };
}
