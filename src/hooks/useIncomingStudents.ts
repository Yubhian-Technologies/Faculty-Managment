import { useEffect, useState } from "react";
import { useAuthStore } from "@/store/authStore";

// "Incoming Students" (pre-registered secondaryDepartment students, plus
// sub-department students - see the page's own accessLevel filter) is an
// HOD-only concept, so every other role skips the fetch entirely rather than
// hitting a route that either 401s for them or would just always be empty.
export function useIncomingStudents() {
  const user = useAuthStore((s) => s.user);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user?.role !== "HOD") {
      setLoading(false);
      return;
    }

    fetch("/api/college/students")
      .then((r) => r.json() as Promise<{ students?: { accessLevel?: string }[] }>)
      .then((d) => {
        const incoming = (d.students ?? []).filter((s) => s.accessLevel === "secondary");
        setCount(incoming.length);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [user?.role, user?.uid]);

  return { hasIncomingStudents: count > 0, incomingCount: count, loading };
}
