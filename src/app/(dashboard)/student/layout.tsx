import type { ReactNode } from "react";
import { StudentPasswordGate } from "@/components/students/StudentPasswordGate";

// Every page of the student portal sits behind the first-sign-in password gate.
export default function StudentLayout({ children }: { children: ReactNode }) {
  return <StudentPasswordGate>{children}</StudentPasswordGate>;
}
