"use client";

import { PageHeader } from "@/components/shared/PageHeader";
import { MyExamSeating } from "@/components/exams/MyExamSeating";

// Student: where they sit in each published exam seating (room, bench, seat).
export default function MyExamSeatPage() {
  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader title="My Exam Seat" description="Your room and bench for each exam, as published by the Exam Cell." />
      <MyExamSeating mode="student" />
    </div>
  );
}
