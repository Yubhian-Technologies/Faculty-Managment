import { redirect } from "next/navigation";

// Retired drill-down (section -> year -> month): use Attendance Reports.
export default function Page() {
  redirect("/hod/attendance-reports");
}
