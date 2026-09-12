"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { CertificateUploadField } from "@/components/shared/CertificateUploadField";
import { NumInput, TextInput, DateInput } from "@/components/shared/ProfileFieldPrimitives";
import type {
  TrainingEntry, TrainingEntryType, TrainingParticipationRole, TrainingProgramLevel, TrainingProgramMode,
  TrainingBeneficiaryType, TrainingBeneficiaryDepartmentEntry, TrainingBeneficiarySection, TrainingCoConductor,
} from "@/types";
import {
  TRAINING_ENTRY_TYPE_LABELS, TRAINING_PARTICIPATION_ROLE_LABELS,
  TRAINING_PROGRAM_LEVEL_LABELS, TRAINING_PROGRAM_MODE_LABELS, TRAINING_BENEFICIARY_TYPE_LABELS,
} from "@/types";

// Inclusive day count between two "YYYY-MM-DD" dates (both days count, so a
// program running Mon-Fri is 5 days, not 4) - undefined until both ends are
// set and parse cleanly, rather than a stale/zero value.
export function calcDurationDays(from: string | undefined, to: string | undefined): number | undefined {
  if (!from || !to) return undefined;
  const f = new Date(from).getTime();
  const t = new Date(to).getTime();
  if (Number.isNaN(f) || Number.isNaN(t) || t < f) return undefined;
  return Math.round((t - f) / 86400000) + 1;
}

// A record saved before "Resource Persons - Details" became a per-person
// list still has this stored as a single free-text string in Firestore even
// though the type now says string[] - every reader normalizes through here
// rather than trusting the type at runtime (a raw string would crash .map()/
// spread as if it were an array of characters).
export function normalizeResourcePersonsDetails(value: string[] | string | undefined): string[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value.trim()) return [value];
  return [];
}

const YEARS = [1, 2, 3, 4];

interface DepartmentOption { id: string; name: string; }
interface CourseOption { id: string; name: string; departmentId: string; department: string; durationYears: number; }
interface FacultyOption { id: string; name: string; department: string; }
interface SectionOption { id: string; name: string; year: number; }

function useDepartmentOptions(): DepartmentOption[] {
  const [departments, setDepartments] = useState<DepartmentOption[]>([]);
  useEffect(() => {
    fetch("/api/college/departments")
      .then((r) => r.json() as Promise<{ departments?: { id: string; name: string }[] }>)
      .then((d) => setDepartments((d.departments ?? []).map((x) => ({ id: x.id, name: x.name }))))
      .catch(() => {});
  }, []);
  return departments;
}

function useCourseOptions(): CourseOption[] {
  const [courses, setCourses] = useState<CourseOption[]>([]);
  useEffect(() => {
    fetch("/api/college/courses/lookup")
      .then((r) => r.json() as Promise<{ courses?: CourseOption[] }>)
      .then((d) => setCourses(d.courses ?? []))
      .catch(() => {});
  }, []);
  return courses;
}

// Sum of every section's count across every Course/Year entry - the
// Beneficiaries "Total Count" for Students is always this, never typed in
// directly (see the caller).
function sumBeneficiarySections(entries: TrainingBeneficiaryDepartmentEntry[]): number {
  return entries.reduce((sum, e) => sum + e.sections.reduce((s, sec) => s + (sec.count || 0), 0), 0);
}

function BeneficiaryDepartmentCard({
  entry, onChange, onRemove,
}: {
  entry: TrainingBeneficiaryDepartmentEntry;
  onChange: (next: TrainingBeneficiaryDepartmentEntry) => void;
  onRemove: () => void;
}) {
  return (
    <div className="rounded-md border bg-background p-2 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium">{entry.courseName} · {entry.department} · Year {entry.year}</p>
        <Button type="button" variant="ghost" size="sm" onClick={onRemove}>
          <Trash2 className="h-3.5 w-3.5 text-destructive" />
        </Button>
      </div>
      {entry.sections.length === 0 ? (
        <p className="text-xs text-muted-foreground">No sections found for this course/year.</p>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {entry.sections.map((s, i) => (
            <NumInput
              key={s.sectionId}
              label={`Section ${s.sectionName}`}
              value={s.count || undefined}
              onChange={(v) => {
                const nextSections = [...entry.sections];
                nextSections[i] = { ...nextSections[i], count: v };
                onChange({ ...entry, sections: nextSections });
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// Course + Year are picked first, then that course/year's sections load
// right here with a count input each - filled in as part of the same "add"
// step, not after (the old flow committed an empty-counts card immediately
// on Course/Year selection, pushing section counts into a separate follow-up
// edit). Only "Add Course / Year" commits the whole thing - course, year,
// and every section's count - to the list at once; the form then resets so
// another course/year can be added the same way.
function AddBeneficiaryDepartment({
  courses, existingCourseYears, onAdd,
}: {
  courses: CourseOption[];
  existingCourseYears: Set<string>;
  onAdd: (entry: TrainingBeneficiaryDepartmentEntry) => void;
}) {
  const [courseId, setCourseId] = useState("");
  const [year, setYear] = useState<number | undefined>(undefined);
  const [sections, setSections] = useState<TrainingBeneficiarySection[]>([]);
  const [loading, setLoading] = useState(false);

  const selectedCourse = courses.find((c) => c.id === courseId);
  const yearOptions = selectedCourse ? YEARS.filter((y) => y <= selectedCourse.durationYears) : YEARS;
  const isDuplicate = !!selectedCourse && !!year && existingCourseYears.has(`${selectedCourse.id}:${year}`);

  function selectCourse(v: string) {
    setCourseId(v);
    setYear(undefined);
    setSections([]);
  }

  function selectYear(v: string) {
    const y = Number(v);
    setYear(y);
    setSections([]);
    if (!selectedCourse) return;
    setLoading(true);
    fetch(`/api/college/sections/lookup?courseId=${encodeURIComponent(selectedCourse.id)}&year=${y}`)
      .then((r) => r.json() as Promise<{ sections?: SectionOption[] }>)
      .then((data) => setSections((data.sections ?? []).map((s) => ({ sectionId: s.id, sectionName: s.name, count: 0 }))))
      .catch(() => setSections([]))
      .finally(() => setLoading(false));
  }

  function updateSectionCount(sectionId: string, count: number) {
    setSections((prev) => prev.map((s) => (s.sectionId === sectionId ? { ...s, count } : s)));
  }

  function handleAdd() {
    if (!selectedCourse || !year || isDuplicate) return;
    onAdd({
      courseId: selectedCourse.id,
      courseName: selectedCourse.name,
      departmentId: selectedCourse.departmentId,
      department: selectedCourse.department,
      year,
      sections,
    });
    setCourseId("");
    setYear(undefined);
    setSections([]);
  }

  return (
    <div className="space-y-2 rounded-md border border-dashed p-2">
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label className="text-xs">Course</Label>
          <Select value={courseId} onValueChange={selectCourse}>
            <SelectTrigger className="w-56"><SelectValue placeholder="Select course" /></SelectTrigger>
            <SelectContent>
              {courses.map((c) => <SelectItem key={c.id} value={c.id}>{c.name} ({c.department})</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Year</Label>
          <Select value={year ? String(year) : ""} onValueChange={selectYear} disabled={!courseId}>
            <SelectTrigger className="w-28"><SelectValue placeholder="Year" /></SelectTrigger>
            <SelectContent>
              {yearOptions.map((y) => <SelectItem key={y} value={String(y)}>Year {y}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {loading && <p className="text-xs text-muted-foreground">Loading sections…</p>}
      {!loading && year && sections.length === 0 && (
        <p className="text-xs text-muted-foreground">No sections found for this course/year.</p>
      )}
      {sections.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {sections.map((s) => (
            <NumInput
              key={s.sectionId}
              label={`Section ${s.sectionName}`}
              value={s.count || undefined}
              onChange={(v) => updateSectionCount(s.sectionId, v)}
            />
          ))}
        </div>
      )}
      {isDuplicate && <p className="text-xs text-destructive">This course/year has already been added.</p>}

      <Button type="button" variant="outline" size="sm" disabled={!courseId || !year || loading || isDuplicate} onClick={handleAdd}>
        <Plus className="h-3.5 w-3.5 mr-1" />Add Course / Year
      </Button>
    </div>
  );
}

function CoConductorFields({
  item, update, ownerFacultyId, ownerFacultyName, departments, readOnly,
}: {
  item: TrainingEntry;
  update: (patch: Partial<TrainingEntry>) => void;
  ownerFacultyId?: string;
  ownerFacultyName?: string;
  departments: DepartmentOption[];
  // True on a co-conductor's own synced copy - only the organizer (the
  // master copy, i.e. !readOnly) can add/remove co-conductors; everyone else
  // gets a view-only list, per the sync design (syncTrainingEntryCoConductors).
  readOnly: boolean;
}) {
  const coConductors = item.coConductors ?? [];
  const [departmentId, setDepartmentId] = useState("");
  const [facultyOptions, setFacultyOptions] = useState<FacultyOption[]>([]);
  const [facultyId, setFacultyId] = useState("");
  const [loadingFaculty, setLoadingFaculty] = useState(false);

  useEffect(() => {
    if (!departmentId) return;
    fetch(`/api/college/faculty/lookup?departmentId=${encodeURIComponent(departmentId)}`)
      .then((r) => r.json() as Promise<{ faculty?: FacultyOption[] }>)
      .then((d) => setFacultyOptions(d.faculty ?? []))
      .catch(() => setFacultyOptions([]))
      .finally(() => setLoadingFaculty(false));
  }, [departmentId]);

  function selectDepartment(v: string) {
    setDepartmentId(v);
    setFacultyId("");
    setFacultyOptions([]);
    setLoadingFaculty(true);
  }

  const alreadyAddedIds = new Set(coConductors.map((c) => c.facultyId));
  const selectableFaculty = facultyOptions.filter((f) => !alreadyAddedIds.has(f.id) && f.id !== ownerFacultyId);

  function addCoConductor() {
    const f = selectableFaculty.find((x) => x.id === facultyId);
    if (!f) return;
    const next: TrainingCoConductor = { order: coConductors.length + 2, facultyId: f.id, name: f.name, department: f.department };
    update({ coConductors: [...coConductors, next], id: item.id ?? crypto.randomUUID() });
    setFacultyId("");
  }

  function removeCoConductor(facultyId: string) {
    const next = coConductors
      .filter((c) => c.facultyId !== facultyId)
      .map((c, i) => ({ ...c, order: i + 2 }));
    update({ coConductors: next });
  }

  // The organizer is whoever created this entry - item.ownerFacultyName on a
  // synced copy (set by syncTrainingEntryCoConductors), or the current page's
  // own owner when this IS the master entry. Never the page-viewer's own name
  // on a copy - that person is a co-conductor here, not the organizer.
  const organizerName = item.isCoConductedCopy ? (item.ownerFacultyName || "Another faculty member") : (ownerFacultyName || "You");
  const viewerIsOrganizer = !item.isCoConductedCopy;

  return (
    <div className="sm:col-span-2 space-y-2 rounded-lg border p-3">
      <Label>Name of the Faculty / Coordinator</Label>
      <div className="space-y-1">
        <p className="text-sm">
          1. {organizerName} {viewerIsOrganizer && <span className="text-xs text-muted-foreground">(You)</span>}
        </p>
        {coConductors.map((c) => (
          <div key={c.facultyId} className="flex items-center justify-between text-sm">
            <span>
              {c.order}. {c.name} <span className="text-xs text-muted-foreground">({c.department})</span>
              {c.facultyId === ownerFacultyId && <span className="text-xs text-muted-foreground"> (You)</span>}
            </span>
            {!readOnly && (
              <Button type="button" variant="ghost" size="sm" onClick={() => removeCoConductor(c.facultyId)}>
                <Trash2 className="h-3.5 w-3.5 text-destructive" />
              </Button>
            )}
          </div>
        ))}
      </div>
      {!readOnly && (
        <div className="flex flex-wrap items-end gap-2 pt-1">
          <div className="space-y-1">
            <Label className="text-xs">Department</Label>
            <Select value={departmentId} onValueChange={selectDepartment}>
              <SelectTrigger className="w-44"><SelectValue placeholder="Select department" /></SelectTrigger>
              <SelectContent>
                {departments.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Faculty</Label>
            <Select value={facultyId} onValueChange={setFacultyId} disabled={!departmentId || loadingFaculty}>
              <SelectTrigger className="w-52"><SelectValue placeholder={loadingFaculty ? "Loading…" : "Select faculty"} /></SelectTrigger>
              <SelectContent>
                {selectableFaculty.map((f) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Button type="button" variant="outline" size="sm" disabled={!facultyId} onClick={addCoConductor}>
            <Plus className="h-3.5 w-3.5 mr-1" />Add Co-Conducting Faculty
          </Button>
        </div>
      )}
    </div>
  );
}

interface TrainingEntryFieldsProps {
  item: TrainingEntry;
  update: (patch: Partial<TrainingEntry>) => void;
  // The profile this Mentorship module belongs to - undefined during the
  // Add-Faculty wizard, where the record (and its own facultyId) doesn't
  // exist yet, so co-conductor sync can't apply until the entry is next
  // edited via the module edit page (see syncTrainingEntryCoConductors).
  ownerFacultyId?: string;
  ownerFacultyName?: string;
}

export function TrainingEntryFields({ item, update, ownerFacultyId, ownerFacultyName }: TrainingEntryFieldsProps) {
  const departments = useDepartmentOptions();
  const courses = useCourseOptions();
  const readOnly = !!item.isCoConductedCopy;
  const beneficiaryDepartments = item.beneficiaryDepartments ?? [];
  const existingCourseYears = new Set(beneficiaryDepartments.map((d) => `${d.courseId}:${d.year}`));

  // organizer only ever got set at the moment "Conducted" was first picked
  // (see the Select below) - if ownerFacultyName wasn't available yet at
  // that instant (e.g. mid Add-Faculty wizard, before the record has a name
  // locked in), it saved blank and nothing ever corrected it afterwards,
  // even though the "1. {organizer}" line above the co-conductor list looked
  // right here the whole time (it renders live from ownerFacultyName, not
  // from the stored field). This keeps the stored value truthfully in sync
  // whenever a real name becomes available, self-healing on next save.
  useEffect(() => {
    if (!readOnly && item.role === "CONDUCTED" && ownerFacultyName && item.organizer !== ownerFacultyName) {
      update({ organizer: ownerFacultyName });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readOnly, item.role, item.organizer, ownerFacultyName]);

  return (
    <>
      {readOnly && (
        <div className="sm:col-span-2 rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
          Added automatically — conducted by {item.ownerFacultyName ?? "another faculty member"}. Edit it from their profile.
        </div>
      )}
      <fieldset disabled={readOnly} className="contents">
        <div className="space-y-2">
          <Label>Type</Label>
          <Select value={item.type} onValueChange={(v) => update({ type: v as TrainingEntryType, otherType: v === "OTHER" ? item.otherType : undefined })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.entries(TRAINING_ENTRY_TYPE_LABELS).map(([k, label]) => (
                <SelectItem key={k} value={k}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {item.type === "OTHER" && (
          <TextInput label="Please specify type" value={item.otherType} onChange={(v) => update({ otherType: v })} />
        )}
        <div className="space-y-2">
          <Label>Participated or Conducted</Label>
          <Select
            value={item.role ?? ""}
            onValueChange={(v) => update({
              role: v as TrainingParticipationRole,
              organizer: v === "CONDUCTED" ? (ownerFacultyName ?? "") : "",
              coConductors: v === "CONDUCTED" ? item.coConductors : undefined,
              remark: v === "PARTICIPATED" ? item.remark : undefined,
            })}
          >
            <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
            <SelectContent>
              {Object.entries(TRAINING_PARTICIPATION_ROLE_LABELS).map(([k, label]) => (
                <SelectItem key={k} value={k}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <TextInput label="Title of the Program" value={item.title} onChange={(v) => update({ title: v })} />
        <DateInput
          label="From Date"
          value={item.fromDate}
          onChange={(v) => update({ fromDate: v, durationDays: calcDurationDays(v, item.toDate) })}
        />
        <DateInput
          label="To Date"
          value={item.toDate}
          onChange={(v) => update({ toDate: v, durationDays: calcDurationDays(item.fromDate, v) })}
          min={item.fromDate}
        />
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">Duration</Label>
          <p className="text-sm font-medium pt-2">{item.durationDays ? `${item.durationDays} day${item.durationDays === 1 ? "" : "s"}` : "-"}</p>
        </div>
        <div className="space-y-2">
          <Label>National / International</Label>
          <Select value={item.levelOfProgram ?? ""} onValueChange={(v) => update({ levelOfProgram: v as TrainingProgramLevel })}>
            <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
            <SelectContent>
              {Object.entries(TRAINING_PROGRAM_LEVEL_LABELS).map(([k, label]) => (
                <SelectItem key={k} value={k}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <TextInput label="Place" value={item.place} onChange={(v) => update({ place: v })} placeholder="e.g. Bhimavaram" />
        <div className="space-y-2">
          <Label>Mode of the Program</Label>
          <Select value={item.mode ?? ""} onValueChange={(v) => update({ mode: v as TrainingProgramMode })}>
            <SelectTrigger><SelectValue placeholder="Select mode" /></SelectTrigger>
            <SelectContent>
              {Object.entries(TRAINING_PROGRAM_MODE_LABELS).map(([k, label]) => (
                <SelectItem key={k} value={k}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {item.role && (
          <div className="sm:col-span-2 space-y-2 rounded-lg border p-3">
            <Label>Beneficiaries</Label>
            <Select value={item.beneficiaryType ?? ""} onValueChange={(v) => update({ beneficiaryType: v as TrainingBeneficiaryType })}>
              <SelectTrigger className="w-44"><SelectValue placeholder="Students / Faculty" /></SelectTrigger>
              <SelectContent>
                {Object.entries(TRAINING_BENEFICIARY_TYPE_LABELS).map(([k, label]) => (
                  <SelectItem key={k} value={k}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {item.beneficiaryType === "STUDENTS" && (
              <div className="space-y-2">
                {beneficiaryDepartments.map((d, i) => (
                  <BeneficiaryDepartmentCard
                    key={`${d.courseId}-${d.year}`}
                    entry={d}
                    onChange={(next) => {
                      const nextList = [...beneficiaryDepartments];
                      nextList[i] = next;
                      update({ beneficiaryDepartments: nextList, beneficiaryTotalCount: sumBeneficiarySections(nextList) });
                    }}
                    onRemove={() => {
                      const nextList = beneficiaryDepartments.filter((_, idx) => idx !== i);
                      update({ beneficiaryDepartments: nextList, beneficiaryTotalCount: sumBeneficiarySections(nextList) });
                    }}
                  />
                ))}
                <AddBeneficiaryDepartment
                  courses={courses}
                  existingCourseYears={existingCourseYears}
                  onAdd={(entry) => {
                    const nextList = [...beneficiaryDepartments, entry];
                    update({ beneficiaryDepartments: nextList, beneficiaryTotalCount: sumBeneficiarySections(nextList) });
                  }}
                />
                <div className="space-y-2">
                  <Label>Total Count</Label>
                  {/* Sum of every section's count above - not entered directly. */}
                  <Input value={sumBeneficiarySections(beneficiaryDepartments)} readOnly disabled className="bg-muted max-w-xs" />
                </div>
              </div>
            )}

            {item.beneficiaryType === "FACULTY" && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <NumInput
                  label="Internal"
                  value={item.beneficiaryInternalCount}
                  onChange={(v) => update({ beneficiaryInternalCount: v, beneficiaryTotalCount: v + (item.beneficiaryExternalCount ?? 0) })}
                />
                <NumInput
                  label="External"
                  value={item.beneficiaryExternalCount}
                  onChange={(v) => update({ beneficiaryExternalCount: v, beneficiaryTotalCount: (item.beneficiaryInternalCount ?? 0) + v })}
                />
                <div className="space-y-2">
                  <Label>Total Count</Label>
                  {/* Internal + External - not entered directly. */}
                  <Input value={(item.beneficiaryInternalCount ?? 0) + (item.beneficiaryExternalCount ?? 0)} readOnly disabled className="bg-muted" />
                </div>
              </div>
            )}
          </div>
        )}

        {item.role === "CONDUCTED" && (
          <CoConductorFields
            item={item} update={update} ownerFacultyId={ownerFacultyId} ownerFacultyName={ownerFacultyName}
            departments={departments} readOnly={readOnly}
          />
        )}
        {item.role === "PARTICIPATED" && (
          <div className="sm:col-span-2 space-y-2">
            <Label>Remark</Label>
            <Textarea value={item.remark ?? ""} onChange={(e) => update({ remark: e.target.value })} />
          </div>
        )}

        <NumInput
          label="Number of Resource Persons"
          value={item.numberOfResourcePersons}
          onChange={(v) => update({
            numberOfResourcePersons: v,
            // Keep the details array in lockstep with the count - growing it
            // pads with blanks, shrinking it drops the trailing entries.
            resourcePersonsDetails: Array.from({ length: v }, (_, i) => normalizeResourcePersonsDetails(item.resourcePersonsDetails)[i] ?? ""),
          })}
        />
        {Array.from({ length: item.numberOfResourcePersons ?? 0 }).map((_, i) => (
          <TextInput
            key={i}
            label={`Resource Person ${i + 1} - Details`}
            value={normalizeResourcePersonsDetails(item.resourcePersonsDetails)[i]}
            onChange={(v) => {
              const next = [...normalizeResourcePersonsDetails(item.resourcePersonsDetails)];
              next[i] = v;
              update({ resourcePersonsDetails: next });
            }}
            placeholder="Name / affiliation"
          />
        ))}
        <div className="sm:col-span-2 space-y-1.5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <CertificateUploadField
              value={item.certificateUrl}
              onUploaded={(url) => update({ certificateUrl: url })}
              onRemoved={() => update({ certificateUrl: "" })}
              buttonText="Upload Certificate"
            />
            <CertificateUploadField
              value={item.brochureUrl}
              onUploaded={(url) => update({ brochureUrl: url })}
              onRemoved={() => update({ brochureUrl: "" })}
              label="Brochure"
              uploadedText="Brochure uploaded"
              buttonText="Upload Brochure"
            />
          </div>
          <p className="text-xs text-muted-foreground">PNG, JPG, or PDF · max 5 MB</p>
        </div>
        <div className="sm:col-span-2 space-y-2">
          <Label>Other Details</Label>
          <Textarea value={item.otherDetails ?? ""} onChange={(e) => update({ otherDetails: e.target.value })} />
        </div>
      </fieldset>
    </>
  );
}
