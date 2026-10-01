import { redirect } from "next/navigation";

// Retired: the section/student attendance views live on one filter + Load page.
export default function Page() {
  redirect("/principal/attendance-reports");
}
