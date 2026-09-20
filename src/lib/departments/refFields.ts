// Every place a department is stored by NAME, with the companion id field that
// carries its stable identity. ONE list, shared by: the rename cascade
// (renameCascade.ts - refreshes the display-name copy), the write-path stamping
// (stampIds.ts uses the same pairs) and, mirrored, scripts/lib/departmentRefs.mjs
// (audit / migrate). refFields.test.ts fails if this and the script catalog
// drift apart, which is what used to happen (the old cascade silently missed
// ~20 collections).
//
// kind: scalar        - string field
//       array         - string[] field (ids stored index-aligned in idField)
//       nestedScopes  - departments.courseScopes[*].secondaryDepartments

export interface DepartmentRefField {
  collection: string;
  field: string;
  idField: string;
  kind: "scalar" | "array" | "nestedScopes";
}

const DEPARTMENT_SCALAR_COLLECTIONS = [
  "subjects", "facultyMembers", "supportingStaff", "teachingAssignments", "timetableSlots", "timetableDrafts",
  "attendanceRecords", "studentAttendance", "permissionRequests", "onDutyRequests", "leaveRequests",
  "employeeLeaveProfiles", "salaryRecords", "appraisals", "facultyAccountRequests", "emailRequests",
  "vacancyRequests", "hiringBatches", "candidates", "candidateApplications", "offerLetters",
  "appointmentLetters", "budgetRequests", "budgetCycles", "financeBudgets", "financePurchaseClearance",
  "indentRequests", "attendanceCheckInPermissions", "examConfigurations", "internalExamMarks",
  "classWorkRecords", "consultancyProjects", "facultyRequirement", "publications", "sections", "students", "users",
];

export const DEPARTMENT_REF_FIELDS: DepartmentRefField[] = [
  ...DEPARTMENT_SCALAR_COLLECTIONS.map((collection) => ({ collection, field: "department", idField: "departmentId", kind: "scalar" as const })),
  { collection: "students", field: "secondaryDepartment", idField: "secondaryDepartmentId", kind: "scalar" },
  { collection: "timetableIncharges", field: "departmentName", idField: "departmentId", kind: "scalar" },
  { collection: "facultyAssignmentRequests", field: "requestingDepartment", idField: "requestingDepartmentId", kind: "scalar" },
  { collection: "facultyAssignmentRequests", field: "targetDepartmentName", idField: "targetDepartmentId", kind: "scalar" },
  { collection: "phdSupervisions", field: "scholarDepartment", idField: "scholarDepartmentId", kind: "scalar" },
  { collection: "sponsoredProjects", field: "piDepartment", idField: "piDepartmentId", kind: "scalar" },
  { collection: "roleSeats", field: "departmentName", idField: "departmentId", kind: "scalar" },
  { collection: "sections", field: "secondaryDepartments", idField: "secondaryDepartmentIds", kind: "array" },
  { collection: "users", field: "departments", idField: "departmentIds", kind: "array" },
  { collection: "departments", field: "secondaryDepartments", idField: "secondaryDepartmentIds", kind: "array" },
  { collection: "departments", field: "managedDepartments", idField: "managedDepartmentIds", kind: "array" },
  { collection: "departments", field: "courseScopes", idField: "secondaryDepartmentIds", kind: "nestedScopes" },
];
