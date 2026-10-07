"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { SegmentedTabs } from "@/components/shared/SegmentedTabs";
import { AddStudentsImport } from "@/components/students/AddStudentsImport";
import { RollNumberMappingImport } from "@/components/students/RollNumberMappingImport";

// Two import modes on one page:
//
//   Add students      - the original flow, creating students from a file.
//   Map roll numbers  - fills Roll No in on students who already exist,
//                       matched on Student Mobile No.
//
// They share nothing but this tab strip. Each owns its own file, its own
// parsed rows and its own results, and switching tabs unmounts the other -
// so a preview produced by one can never be applied by the other.
type Mode = "add" | "map";

const TABS = [
  { key: "add", label: "Add students" },
  { key: "map", label: "Map roll numbers" },
];

function ImportTabs() {
  const searchParams = useSearchParams();

  // Arriving from a section card's "Add Students" button carries the section in
  // the URL. That context belongs to the Add flow and means nothing to roll
  // mapping, so such a link always lands on Add and the tabs are hidden - the
  // Office came here to do one specific thing.
  const isSectionLocked = !!(
    searchParams.get("sectionId") &&
    searchParams.get("section") &&
    searchParams.get("department") &&
    searchParams.get("year")
  );

  const [mode, setMode] = useState<Mode>("add");
  const active: Mode = isSectionLocked ? "add" : mode;

  return (
    <div className="space-y-6">
      {!isSectionLocked && (
        <SegmentedTabs options={TABS} value={active} onChange={(k) => setMode(k as Mode)} />
      )}
      {active === "add" ? <AddStudentsImport /> : <RollNumberMappingImport />}
    </div>
  );
}

export default function OfficeStudentImportPage() {
  // useSearchParams needs a boundary above it.
  return (
    <Suspense fallback={null}>
      <ImportTabs />
    </Suspense>
  );
}
