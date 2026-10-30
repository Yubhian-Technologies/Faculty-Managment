import { redirect } from "next/navigation";

// The Staff list now lives under Faculty > Staff. Kept as a redirect for old links and the Back buttons of the staff detail pages.
export default function PrincipalStaffPage() {
  redirect("/principal/faculty/staff");
}
