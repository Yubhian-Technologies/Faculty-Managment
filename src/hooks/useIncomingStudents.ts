import { useEffect, useState } from "react";
import { useAuthStore } from "@/store/authStore";

// "First Year Students" is an HOD-only concept, so every other role skips the
// fetch entirely rather than hitting a route that either 401s for them or
// would just always be empty.
//
// The API's `accessLevel: "secondary"` tag is deliberately coarse - it covers
// both a student pre-registered to this HOD's department while primarily
// enrolled elsewhere (StudentRecord.secondaryDepartment - the actual "first
// year, not yet promoted" concept this page is about) AND a student who
// simply belongs to one of this HOD's own sub-departments (view-only access
// to their own department tree, unrelated to promotion). Filtering on
// `secondaryDepartment` directly, instead of the shared `accessLevel` tag,
// is what keeps sub-department students - who already show up on the
// regular Students list - from also flooding this one.
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
      .then((r) => r.json() as Promise<{ students?: { secondaryDepartment?: string }[] }>)
      .then((d) => {
        const incoming = (d.students ?? []).filter((s) => s.secondaryDepartment === user.department);
        setCount(incoming.length);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [user?.role, user?.uid, user?.department]);

  return { hasIncomingStudents: count > 0, incomingCount: count, loading };
}
