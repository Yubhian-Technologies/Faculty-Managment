// "Where did the user come from" for the HOD Students list. The list is a
// filtered, searched, paged view; a student's profile / attendance page opened
// from it carries that list's URL in `?back=` so Back returns to the same view
// instead of an empty, unloaded list. The list also mirrors its own state into
// its address bar, so the browser's Back button and a refresh restore it too.
// Only same-app paths under /hod/students are honoured, so the param can never
// be used as an open redirect.
//
// `back` (not `from`): the attendance page already reads `from`/`to` as dates.

export const HOD_STUDENTS_LIST_PATH = "/hod/students";
export const HOD_STUDENTS_BACK_PARAM = "back";

const PAGE_SIZES = [10, 20, 30, 50]; // Pagination's options
export const HOD_STUDENTS_DEFAULT_PAGE_SIZE = 20;

export interface HodStudentsListState {
  /** Whether the list had been loaded (the Load button pressed). */
  load: boolean;
  freshmanView: string;
  deptFilter: string;
  coreDeptFilter: string;
  courseFilter: string;
  yearFilter: string;
  search: string;
  page: number;
  pageSize: number;
}

export const EMPTY_HOD_STUDENTS_LIST_STATE: HodStudentsListState = {
  load: false,
  freshmanView: "none",
  deptFilter: "all",
  coreDeptFilter: "all",
  courseFilter: "all",
  yearFilter: "all",
  search: "",
  page: 1,
  pageSize: HOD_STUDENTS_DEFAULT_PAGE_SIZE,
};

type ParamReader = { get(name: string): string | null };

/** The list state a URL describes; anything missing or malformed falls back to the default. */
export function parseHodStudentsListState(params: ParamReader | null | undefined): HodStudentsListState {
  const d = EMPTY_HOD_STUDENTS_LIST_STATE;
  if (!params || params.get("load") !== "1") return d;
  const page = Number(params.get("page"));
  const pageSize = Number(params.get("pageSize"));
  const year = params.get("year");
  return {
    load: true,
    freshmanView: params.get("incoming") || d.freshmanView,
    deptFilter: params.get("department") || d.deptFilter,
    coreDeptFilter: params.get("coreDepartment") || d.coreDeptFilter,
    courseFilter: params.get("course") || d.courseFilter,
    yearFilter: year && /^\d+$/.test(year) ? year : d.yearFilter,
    search: params.get("q") ?? d.search,
    page: Number.isInteger(page) && page >= 1 ? page : d.page,
    pageSize: PAGE_SIZES.includes(pageSize) ? pageSize : d.pageSize,
  };
}

/** The list URL for a state - the bare list path until the list has been loaded. */
export function buildHodStudentsListUrl(state: HodStudentsListState): string {
  if (!state.load) return HOD_STUDENTS_LIST_PATH;
  const d = EMPTY_HOD_STUDENTS_LIST_STATE;
  const p = new URLSearchParams();
  p.set("load", "1");
  if (state.freshmanView !== d.freshmanView) p.set("incoming", state.freshmanView);
  if (state.deptFilter !== d.deptFilter) p.set("department", state.deptFilter);
  if (state.coreDeptFilter !== d.coreDeptFilter) p.set("coreDepartment", state.coreDeptFilter);
  if (state.courseFilter !== d.courseFilter) p.set("course", state.courseFilter);
  if (state.yearFilter !== d.yearFilter) p.set("year", state.yearFilter);
  if (state.search) p.set("q", state.search);
  if (state.page !== d.page) p.set("page", String(state.page));
  if (state.pageSize !== d.pageSize) p.set("pageSize", String(state.pageSize));
  return `${HOD_STUDENTS_LIST_PATH}?${p.toString()}`;
}

/** The validated `?back=` list URL, or null. */
export function safeHodStudentsBack(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (!raw.startsWith(HOD_STUDENTS_LIST_PATH)) return null;
  // "/hod/students/<id>", "/hod/studentsX", protocol-relative and backslash tricks are not the list.
  const next = raw.charAt(HOD_STUDENTS_LIST_PATH.length);
  if (next !== "" && next !== "?") return null;
  if (raw.includes("\\") || raw.startsWith("//")) return null;
  return raw;
}

/** Appends `?back=<listUrl>` to `path` (no-op when there is nothing to carry). */
export function withHodStudentsBack(path: string, listUrl: string | null | undefined): string {
  const safe = safeHodStudentsBack(listUrl);
  if (!safe) return path;
  return `${path}${path.includes("?") ? "&" : "?"}${HOD_STUDENTS_BACK_PARAM}=${encodeURIComponent(safe)}`;
}
