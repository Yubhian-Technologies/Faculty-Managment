import { useEffect, useState } from "react";

// Self-service employeeId lookup, shared by every "My Profile" page's public
// profile link — works for PANEL_MEMBER (facultyMembers record) and
// HOD/PRINCIPAL/VICE_PRINCIPAL (users record) alike, since GET
// /api/college/faculty/me already resolves whichever one applies.
export function useMyEmployeeId(): string | null {
  const [employeeId, setEmployeeId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/college/faculty/me")
      .then((r) => r.json() as Promise<{ faculty: { employeeId?: string } | null }>)
      .then((d) => setEmployeeId(d.faculty?.employeeId ?? null))
      .catch(() => {});
  }, []);

  return employeeId;
}
