import { redirect } from "next/navigation";

// Retired drill-down (section -> month -> date): one filter + Load page now.
export default function Page() {
  redirect("/panel/monthly-records");
}
