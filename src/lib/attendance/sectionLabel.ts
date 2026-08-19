// Resolves each of the given department NAMES to its short department code
// (e.g. "Information Technology" -> "IT"), for the compact "IT-A" section
// label used across the Faculty Attendance Report and HOD Monthly Records
// views. One batched lookup, never per-record.
export async function loadDepartmentCodes(
  collegeRef: FirebaseFirestore.DocumentReference,
  departmentNames: string[],
): Promise<Map<string, string>> {
  const names = Array.from(new Set(departmentNames.filter(Boolean)));
  const codeByName = new Map<string, string>();
  if (names.length === 0) return codeByName;
  const deptsSnap = await collegeRef.collection("departments")
    .where("name", "in", names.slice(0, 30)).get();
  for (const d of deptsSnap.docs) {
    const data = d.data() as { name?: string; code?: string };
    if (data.name && data.code) codeByName.set(data.name, data.code);
  }
  return codeByName;
}

// Some colleges already name sections with the department code baked in
// (e.g. Section.name = "IT-B"); others just use the bare letter ("B"). Only
// prepend the code when it isn't already there, so this never produces
// "IT-IT-B".
export function formatSectionLabel(
  department: string,
  sectionName: string,
  codeByName: Map<string, string>,
): string {
  const code = codeByName.get(department) ?? department;
  return sectionName.toUpperCase().startsWith(`${code.toUpperCase()}-`) ? sectionName : `${code}-${sectionName}`;
}
