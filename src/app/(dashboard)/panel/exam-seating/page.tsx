"use client";

import { PageHeader } from "@/components/shared/PageHeader";
import { MyExamSeating } from "@/components/exams/MyExamSeating";

// Faculty: the rooms where students of the sections they teach sit, per published exam seating.
export default function FacultyExamSeatingPage() {
  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader title="Exam Seating" description="Rooms where your students sit, with their Regd. No ranges, as published by the Exam Cell." />
      <MyExamSeating mode="faculty" />
    </div>
  );
}
