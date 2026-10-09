// Student Strength engine - shared types.
//
// The pipeline is: student documents -> one projected scan (server) ->
// `buildStrengthCube` (a compact GROUP BY: one cell per distinct
// program/branch/year/section/status/batch combination, with a count) ->
// pure filter/report functions -> dashboard, print and Excel export.
//
// Nothing here is ever persisted. A cell exists only for the lifetime of one
// request, so a count can never disagree with the student records it came
// from.

/** The handful of StudentRecord fields the engine reads. Everything else on a student is ignored. */
export interface StrengthRow {
  id: string;
  name?: string;
  rollNumber?: string;
  /** Filing department. For a shared-first-year student this is the common/feeder department. */
  department?: string;
  /** The student's real branch while they sit in a shared first year (cleared on promotion). */
  secondaryDepartment?: string | null;
  course?: string;
  courseId?: string;
  year?: number;
  section?: string;
  status?: string;
  batch?: string;
}

/**
 * One GROUP BY bucket. Every dimension is a normalized KEY (see `normKey`);
 * human labels live in `StrengthMeta`. "" is the "not set" key for every
 * string dimension, and year 0 means "year not set".
 */
export interface StrengthCell {
  program: string;
  branch: string;
  year: number;
  section: string;
  status: string;
  batch: string;
  count: number;
}

export interface ProgramMeta {
  key: string;
  label: string;
  /** Longest duration among Course docs carrying this name (0 when unknown). */
  durationYears: number;
  /** Branch keys of departments that offer this program (from Course docs) - used to show empty rows as 0. */
  branchKeys: string[];
}

export interface BranchMeta {
  key: string;
  /** Full department name as configured. */
  label: string;
  /** Short code, e.g. "CSE" - "" when unknown. */
  code: string;
  /** A grouping/feeder department (e.g. Basic Science) - never listed as an empty row of its own. */
  isFeeder: boolean;
  /** true when this department isn't in the Departments list at all (legacy/renamed text on a student). */
  unknown: boolean;
}

/** A configured Section doc - lets a section with no students yet still show as 0. */
export interface SectionMeta {
  program: string;
  branch: string;
  year: number;
  section: string;
  label: string;
}

export interface StatusMeta {
  key: string;
  label: string;
  /** true when this status counts toward college strength. */
  countsInStrength: boolean;
}

export interface StrengthMeta {
  programs: ProgramMeta[];
  branches: BranchMeta[];
  sections: SectionMeta[];
  /** Section key -> display label, for every section seen on a student or configured. */
  sectionLabels: Record<string, string>;
  statuses: StatusMeta[];
  /** Batch key -> display label. */
  batches: { key: string; label: string }[];
  /** Highest year of study seen anywhere (configured duration or observed). */
  maxYear: number;
  /**
   * Program key -> the years this view's departments are configured to teach
   * FOR THAT PROGRAM. Absent for the college-wide view, where every year of a
   * course is a real choice.
   *
   * Per program, because one department commonly runs more than one with
   * different years: Computer Science and Engineering teaches years 2-4 of the
   * B.Tech and years 1-2 of the M.Tech. Merged into a single list those became
   * 1-4, and the B.Tech picker went on offering a first year the department
   * does not teach - which is the whole thing this exists to stop.
   */
  scopeYearsByProgram?: Record<string, number[]>;
  /**
   * Branch keys this view must not offer in its Department filter.
   *
   * Set only for a department head who has core departments to offer instead:
   * everything they are shown is already theirs, so their OWN department is
   * not a choice - "Basic Science - English" filtering a Basic Science -
   * English HOD's own page narrows nothing. The branches below them are what
   * is worth picking. Never set where it would leave nothing to pick.
   */
  hiddenBranchKeys?: string[];
}

/** "ENROLLED" = every status that counts toward strength; "ALL" = every status incl. graduated/other. */
export type StatusFilter = "ENROLLED" | "ALL" | (string & {});

export interface StrengthFilters {
  program?: string;
  branch?: string;
  year?: number;
  /** Section KEY; "" means students without a section. undefined = every section. */
  section?: string;
  batch?: string;
  status: StatusFilter;
}

export interface DuplicateRoll {
  roll: string;
  count: number;
  holders: { id: string; name: string }[];
}

export interface StrengthHealth {
  /** Students scanned (before status rules). */
  totalRecords: number;
  /** Roll numbers shared by more than one student (case-insensitive). */
  duplicateRolls: DuplicateRoll[];
  /** Enrolled students with no section. */
  enrolledWithoutSection: number;
  /** Enrolled students with no program (course) recorded. */
  enrolledWithoutProgram: number;
  /** Enrolled students with no year of study recorded. */
  enrolledWithoutYear: number;
  /** Enrolled students whose branch isn't a configured department. */
  enrolledUnknownBranch: number;
  /** Students whose status isn't one the engine knows (excluded from strength). */
  unrecognizedStatus: number;
}

export interface StrengthPayload {
  generatedAt: string;
  collegeName: string;
  /** Current academic session label, e.g. "2026-27". */
  session: string;
  /** "college" for Principal/Office; "department" when an HOD's scope was applied. */
  scope: "college" | "department";
  meta: StrengthMeta;
  cells: StrengthCell[];
  health: StrengthHealth;
  /**
   * Independent cross-check: total student docs as answered by a Firestore
   * COUNT() aggregation vs how many the scan actually read. null for a
   * department-scoped caller (a scope-filtered total has no equivalent
   * single COUNT).
   */
  integrity: { databaseCount: number; scannedRecords: number } | null;
}

// ─── Report model (what the tables and the Excel export render) ────────────

export interface MatrixRow {
  branch: string;
  label: string;
  code: string;
  byYear: Record<number, number>;
  total: number;
}

export interface ProgramMatrix {
  program: string;
  label: string;
  years: number[];
  rows: MatrixRow[];
  byYear: Record<number, number>;
  total: number;
}

export interface SectionRow {
  program: string;
  programLabel: string;
  branch: string;
  branchLabel: string;
  branchCode: string;
  year: number;
  section: string;
  sectionLabel: string;
  count: number;
}

export interface StrengthReport {
  total: number;
  matrices: ProgramMatrix[];
  sections: SectionRow[];
}
