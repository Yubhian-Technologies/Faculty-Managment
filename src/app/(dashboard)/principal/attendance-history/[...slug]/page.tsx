import { redirect } from "next/navigation";

// Retired drill-down route: the report is now one filter + Load page.
export default function Page() {
  redirect("/principal/attendance-reports");
}
