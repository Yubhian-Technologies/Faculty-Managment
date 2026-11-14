import type { Metadata } from "next";
import type { ReactNode } from "react";

// Mark Attendance can be added to the phone's home screen as its own app (it opens with no internet - public/sw.js).
export const metadata: Metadata = {
  manifest: "/mark-attendance.webmanifest",
  appleWebApp: { capable: true, title: "Attendance", statusBarStyle: "default" },
  icons: { apple: "/icons/attendance-192.png" },
};

export default function MarkAttendanceLayout({ children }: { children: ReactNode }) {
  return children;
}
