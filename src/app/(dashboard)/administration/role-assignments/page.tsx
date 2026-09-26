import { CollegeRoleAssignments } from "@/components/roles/CollegeRoleAssignments";

// Location Admin (ADMINISTRATION) belongs to no college of its own, so it
// picks which college's seats to manage first - same pattern as Super Admin
// and Management's own Role Assignments pages. /api/admin/colleges already
// scopes its results to session.locationId for this role (same endpoint
// administration/colleges/page.tsx uses), so this only ever lists colleges
// in this Location Admin's own location.
//
// This page was missing despite the rest of the Administration surface
// already pointing at it by name - e.g. api/administration/college-people's
// singleton-seat error ("Hand the seat to someone else from Role Assignments
// instead") and administration/colleges/page.tsx's own comments - leaving a
// Location Admin with no way to hand the College Admin seat to a different
// (or previous) existing person; "Add College Admin" only ever creates a
// brand-new login and correctly refuses an email that already has one.
export default function AdministrationRoleAssignmentsPage() {
  return <CollegeRoleAssignments collegesUrl="/api/admin/colleges" />;
}
