import { CollegeRoleAssignments } from "@/components/roles/CollegeRoleAssignments";

export default function SuperAdminRoleAssignmentsPage() {
  return <CollegeRoleAssignments collegesUrl="/api/admin/colleges" />;
}
