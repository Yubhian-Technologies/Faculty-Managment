"use client";

import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import type {
  PublicationDetails, PublicationType, PublicationAuthor, PublicationIndex, PublicationQuartile,
  AuthorCategory, AuthorRoleType,
} from "@/types";

const OTHERS_COLLEGE_ID = "OTHERS";

const PUBLICATION_TYPE_LABELS: Record<PublicationType, string> = {
  JOURNAL: "Journal", CONFERENCE: "Conference", BOOK_CHAPTER: "Book Chapter", TEXT_BOOK: "Text Book",
};

const AUTHOR_CATEGORY_LABELS: Record<AuthorCategory, string> = {
  FIRST_AUTHOR: "First Author", CO_AUTHOR: "Co-Author", CORRESPONDING_AUTHOR: "Corresponding Author",
};

const AUTHOR_TYPE_LABELS: Record<AuthorRoleType, string> = { FACULTY: "Faculty", STUDENT: "Student" };

// Shared with the R&D record view so both point at the same sources.
import {
  INDEX_LABELS, INDEX_REFERENCE_URLS, QUARTILE_REFERENCE_URL, IMPACT_FACTOR_REFERENCE_URL,
} from "@/lib/research/publicationReferences";

// Journal indexes distinguish WoS-ESCI/WoS-SCIE; Conference/Book Chapter just use plain WoS.
const INDEX_OPTIONS_BY_TYPE: Record<PublicationType, PublicationIndex[]> = {
  JOURNAL: ["SCOPUS", "WOS_ESCI", "WOS_SCIE"],
  CONFERENCE: ["SCOPUS", "WOS"],
  BOOK_CHAPTER: ["SCOPUS", "WOS"],
  TEXT_BOOK: [],
};

const QUARTILE_OPTIONS: PublicationQuartile[] = ["Q1", "Q2", "Q3", "Q4", "NA"];

const SDG_NAMES: Record<number, string> = {
  1: "No Poverty", 2: "Zero Hunger", 3: "Good Health and Well-being", 4: "Quality Education",
  5: "Gender Equality", 6: "Clean Water and Sanitation", 7: "Affordable and Clean Energy",
  8: "Decent Work and Economic Growth", 9: "Industry, Innovation and Infrastructure",
  10: "Reduced Inequalities", 11: "Sustainable Cities and Communities",
  12: "Responsible Consumption and Production", 13: "Climate Action", 14: "Life Below Water",
  15: "Life on Land", 16: "Peace, Justice and Strong Institutions", 17: "Partnerships for the Goals",
};
const SDG_GOALS = Array.from({ length: 17 }, (_, i) => i + 1);

export function emptyPublicationDetails(): PublicationDetails {
  return { type: "JOURNAL", title: "", authors: [], internalAuthorsCount: 0, externalAuthorsCount: 0 };
}

// Best-effort autofill from a bare DOI (e.g. "10.1000/xyz123", not a full
// URL) via Crossref's public metadata API - fills in whatever the DOI
// record actually has; author Internal/External nature can't be inferred
// from Crossref, so every fetched author starts External and can be
// corrected by hand (e.g. flipped to Internal + Faculty ID for a co-author
// who works here).
async function fetchDoiMetadata(doi: string, type: PublicationType): Promise<Partial<PublicationDetails> | null> {
  const res = await fetch(`https://api.crossref.org/works/${encodeURIComponent(doi.trim())}`);
  if (!res.ok) return null;
  const json = await res.json() as { message?: Record<string, unknown> };
  const m = json.message;
  if (!m) return null;

  const venueName = Array.isArray(m["container-title"]) ? (m["container-title"] as string[])[0] : undefined;
  const dateParts = (m["published-print"] ?? m["published-online"] ?? m.issued) as { "date-parts"?: number[][] } | undefined;
  const [year, month] = dateParts?.["date-parts"]?.[0] ?? [];
  const authors = ((m.author as { given?: string; family?: string; affiliation?: { name?: string }[] }[] | undefined) ?? []).map(
    (a, i): PublicationAuthor => ({
      name: [a.given, a.family].filter(Boolean).join(" "),
      category: i === 0 ? "FIRST_AUTHOR" : "CO_AUTHOR",
      authorType: "FACULTY",
      isInternal: false,
      affiliationCollegeId: "OTHERS",
      affiliationCollegeName: a.affiliation?.[0]?.name ?? "",
    })
  );

  const patch: Partial<PublicationDetails> = {
    doi: (m.DOI as string | undefined) ?? doi.trim(),
    ...((m.title as string[] | undefined)?.[0] ? { title: (m.title as string[])[0] } : {}),
    ...(m.publisher ? { publisherName: m.publisher as string } : {}),
    ...(venueName && type === "JOURNAL" ? { journalName: venueName } : {}),
    ...(venueName && type === "CONFERENCE" ? { conferenceName: venueName } : {}),
    ...(venueName && type === "BOOK_CHAPTER" ? { bookName: venueName } : {}),
    ...((m.ISSN as string[] | undefined)?.[0] ? { issnNumber: (m.ISSN as string[])[0] } : {}),
    ...((m.ISBN as string[] | undefined)?.[0] ? { isbnNumber: (m.ISBN as string[])[0] } : {}),
    ...(year ? { monthYearOfPublication: `${year}-${String(month ?? 1).padStart(2, "0")}` } : {}),
    ...(m.URL ? { publishedPaperLink: m.URL as string } : {}),
    ...(authors.length > 0 ? { authors } : {}),
  };
  return patch;
}

export function isPublicationDetailsValid(details: PublicationDetails): boolean {
  if (details.title.trim().length < 2) return false;
  if (!details.citeAs?.trim()) return false;
  if (details.type === "TEXT_BOOK") return true;
  if (!details.sdgGoals || details.sdgGoals.length === 0) return false;
  if (!details.indexedIn || details.indexedIn.length === 0) return false;
  if (details.hasInternationalCollaboration === undefined || details.hasIndustryCollaboration === undefined) return false;
  if (details.type === "JOURNAL" && !details.issnNumber?.trim()) return false;
  if ((details.type === "CONFERENCE" || details.type === "BOOK_CHAPTER") && !details.isbnNumber?.trim()) return false;
  // Scopus/WoS Link and Published Paper Link are compulsory for every type
  // except Text Book (which has its own separate "Provide link of the Book"
  // field instead - see providedBookLink).
  return !!details.scopusOrWosLink?.trim() && !!details.publishedPaperLink?.trim();
}

function emptyAuthor(): PublicationAuthor {
  return { name: "", category: "CO_AUTHOR", authorType: "FACULTY", affiliationCollegeName: "", isInternal: true };
}

function YesNoToggle({ value, onChange }: { value: boolean | undefined; onChange: (v: boolean) => void }) {
  return (
    <div className="flex gap-2">
      <Button type="button" size="sm" variant={value === true ? "default" : "outline"} onClick={() => onChange(true)}>Yes</Button>
      <Button type="button" size="sm" variant={value === false ? "default" : "outline"} onClick={() => onChange(false)}>No</Button>
    </div>
  );
}

function MultiCheckboxGroup<T extends string>({
  options, labels, urls, selected, onChange,
}: {
  options: T[];
  labels: Record<T, string>;
  urls?: Record<T, string>;
  selected: T[] | undefined;
  onChange: (next: T[]) => void;
}) {
  const set = new Set(selected ?? []);
  function toggle(opt: T) {
    const next = new Set(set);
    if (next.has(opt)) next.delete(opt); else next.add(opt);
    onChange(Array.from(next));
  }
  return (
    <div className="flex flex-wrap gap-3">
      {options.map((opt) => (
        <label key={opt} className="flex items-center gap-1.5 text-sm cursor-pointer">
          <Checkbox checked={set.has(opt)} onCheckedChange={() => toggle(opt)} />
          {labels[opt]}
          {urls?.[opt] && (
            <a
              href={urls[opt]} target="_blank" rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-xs text-primary hover:underline"
            >
              ({urls[opt]})
            </a>
          )}
        </label>
      ))}
    </div>
  );
}

function SdgPicker({ selected, onChange }: { selected: number[] | undefined; onChange: (next: number[]) => void }) {
  const set = new Set(selected ?? []);
  function toggle(goal: number) {
    const next = new Set(set);
    if (next.has(goal)) next.delete(goal); else next.add(goal);
    onChange(Array.from(next).sort((a, b) => a - b));
  }
  const summary = set.size === 0 ? "Select SDG(s)" : Array.from(set).sort((a, b) => a - b).map((g) => `SDG ${g}`).join(", ");
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" className="w-full justify-start font-normal">
          <span className="truncate">{summary}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-2 max-h-72 overflow-y-auto" align="start">
        <div className="space-y-1">
          {SDG_GOALS.map((goal) => (
            <label key={goal} className="flex items-center gap-2 text-sm rounded px-1.5 py-1 hover:bg-muted cursor-pointer">
              <Checkbox checked={set.has(goal)} onCheckedChange={() => toggle(goal)} />
              <span className="text-muted-foreground w-14 shrink-0">SDG {goal}</span>
              <span>{SDG_NAMES[goal]}</span>
            </label>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

interface CollegeOption { id: string; name: string }

// Fetches once - shared by every author row rather than each row fetching
// its own copy.
function useCollegeOptions() {
  const [colleges, setColleges] = useState<CollegeOption[]>([]);
  useEffect(() => {
    fetch("/api/college/colleges-directory")
      .then((r) => r.json() as Promise<{ colleges?: CollegeOption[] }>)
      .then((d) => setColleges(d.colleges ?? []))
      .catch(() => setColleges([]));
  }, []);
  return colleges;
}

// Nature of Author is the first choice, and drives everything else:
// - Internal: only a Faculty ID is asked for - the name is looked up from
//   the real facultyMembers record (they're already in the college), not
//   retyped by hand. The server re-verifies this lookup on save.
// - External: Author Type + Name are entered by hand, then Affiliation is a
//   two-step pick - a college elsewhere in this same project (every OTHER
//   college than the submitter's own - excluded since picking your own
//   college would make you Internal, not External), or "Others" for a
//   college/university outside the project entirely (free-text name + country).
function AuthorFields({
  author, update, colleges, ownCollegeId,
}: {
  author: PublicationAuthor;
  update: (patch: Partial<PublicationAuthor>) => void;
  colleges: CollegeOption[];
  ownCollegeId: string;
}) {
  const [lookup, setLookup] = useState<"idle" | "loading" | "found" | "not-found">(
    author.isInternal && author.authorType === "FACULTY" && author.name ? "found" : "idle"
  );
  const otherColleges = colleges.filter((c) => c.id !== ownCollegeId);
  const scope: "PROJECT" | "OTHERS" = author.affiliationCollegeId === OTHERS_COLLEGE_ID ? "OTHERS" : "PROJECT";

  async function lookupFacultyId(facultyId: string) {
    update({ facultyId, name: "" });
    if (!facultyId.trim()) { setLookup("idle"); return; }
    setLookup("loading");
    try {
      const res = await fetch(`/api/college/faculty-lookup?employeeId=${encodeURIComponent(facultyId.trim())}`);
      if (!res.ok) { setLookup("not-found"); return; }
      const data = await res.json() as { name?: string };
      update({ facultyId, name: data.name ?? "" });
      setLookup("found");
    } catch {
      setLookup("not-found");
    }
  }

  function onAffiliationScopeChange(next: "PROJECT" | "OTHERS") {
    if (next === "OTHERS") {
      update({ affiliationCollegeId: OTHERS_COLLEGE_ID, affiliationCollegeName: "" });
    } else {
      update({ affiliationCollegeId: undefined, affiliationCollegeName: "", affiliationCountry: undefined });
    }
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div className="space-y-1.5">
        <Label className="text-xs">Author Position</Label>
        <Select value={author.category} onValueChange={(v) => update({ category: v as AuthorCategory })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {(Object.keys(AUTHOR_CATEGORY_LABELS) as AuthorCategory[]).map((c) => <SelectItem key={c} value={c}>{AUTHOR_CATEGORY_LABELS[c]}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Nature of Author</Label>
        <Select
          value={author.isInternal ? "INTERNAL" : "EXTERNAL"}
          onValueChange={(v) => update(
            v === "INTERNAL"
              ? { isInternal: true, name: "", facultyId: "", studentRegistrationNumber: "", authorType: "FACULTY", affiliationCollegeId: undefined, affiliationCollegeName: "", affiliationCountry: undefined }
              : { isInternal: false, name: "", facultyId: undefined, studentRegistrationNumber: undefined }
          )}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="INTERNAL">Internal Author</SelectItem>
            <SelectItem value="EXTERNAL">External Author</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {author.isInternal ? (
        <>
          <div className="space-y-1.5">
            <Label className="text-xs">Author Type</Label>
            <Select
              value={author.authorType}
              onValueChange={(v) => update({ authorType: v as AuthorRoleType, name: "", facultyId: "", studentRegistrationNumber: "" })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(AUTHOR_TYPE_LABELS) as AuthorRoleType[]).map((t) => <SelectItem key={t} value={t}>{AUTHOR_TYPE_LABELS[t]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {author.authorType === "FACULTY" ? (
            <div className="space-y-1.5">
              <Label className="text-xs">Faculty ID</Label>
              <Input value={author.facultyId ?? ""} onChange={(e) => void lookupFacultyId(e.target.value)} placeholder="Employee ID" />
              {lookup === "loading" && <p className="text-xs text-muted-foreground">Looking up…</p>}
              {lookup === "found" && author.name && <p className="text-xs text-green-700">{author.name}</p>}
              {lookup === "not-found" && <p className="text-xs text-destructive">No faculty member found with that ID</p>}
            </div>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label className="text-xs">Name of the Author</Label>
                <Input value={author.name} onChange={(e) => update({ name: e.target.value })} placeholder="Student name" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Student Registration Number</Label>
                <Input value={author.studentRegistrationNumber ?? ""} onChange={(e) => update({ studentRegistrationNumber: e.target.value })} />
              </div>
            </>
          )}
        </>
      ) : (
        <>
          <div className="space-y-1.5">
            <Label className="text-xs">Name of the Author</Label>
            <Input value={author.name} onChange={(e) => update({ name: e.target.value })} placeholder="Author name" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Affiliation</Label>
            <Select value={scope} onValueChange={(v) => onAffiliationScopeChange(v as "PROJECT" | "OTHERS")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="PROJECT">SVES</SelectItem>
                <SelectItem value="OTHERS">Others</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {scope === "PROJECT" ? (
            <div className="space-y-1.5">
              <Label className="text-xs">College</Label>
              <Select
                value={author.affiliationCollegeId ?? ""}
                onValueChange={(id) => update({ affiliationCollegeId: id, affiliationCollegeName: otherColleges.find((c) => c.id === id)?.name ?? "" })}
              >
                <SelectTrigger><SelectValue placeholder="Select college" /></SelectTrigger>
                <SelectContent>
                  {otherColleges.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label className="text-xs">Affiliation Name</Label>
                <Input value={author.affiliationCollegeName} onChange={(e) => update({ affiliationCollegeName: e.target.value })} placeholder="College/university name" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Country</Label>
                <Input value={author.affiliationCountry ?? ""} onChange={(e) => update({ affiliationCountry: e.target.value })} placeholder="Country" />
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

// The rich, type-specific field set shared by every place a publication is
// captured by hand - the self-submit dialog (src/components/faculty/
// PublicationsModuleView.tsx), R&D's own Add/Edit pages (src/app/(dashboard)/
// r-and-d/publications/new and [id]/edit). Fields-only - no Dialog/staff-
// picker chrome, no save/cancel buttons - each caller owns its own submit
// wiring around this.
export function PublicationDetailsForm({
  value, onChange, ownCollegeId,
}: {
  value: PublicationDetails;
  onChange: (next: PublicationDetails) => void;
  ownCollegeId: string;
}) {
  const colleges = useCollegeOptions();
  const [doiInput, setDoiInput] = useState("");
  const [doiFetchState, setDoiFetchState] = useState<"idle" | "loading" | "not-found">("idle");

  function set<K extends keyof PublicationDetails>(key: K, v: PublicationDetails[K]) {
    onChange({ ...value, [key]: v });
  }

  async function handleFetchDoi() {
    if (!doiInput.trim()) return;
    setDoiFetchState("loading");
    try {
      const patch = await fetchDoiMetadata(doiInput, value.type);
      if (!patch) { setDoiFetchState("not-found"); return; }
      onChange({ ...value, ...patch });
      setDoiFetchState("idle");
    } catch {
      setDoiFetchState("not-found");
    }
  }

  function setType(type: PublicationType) {
    // Switching type clears the fields that belonged only to the previous
    // type, so a half-filled Journal field set can't leak into a Conference
    // submission.
    onChange({ ...emptyPublicationDetails(), type, title: value.title, authors: value.authors });
  }

  const internalCount = value.authors.filter((a) => a.isInternal).length;
  const externalCount = value.authors.length - internalCount;

  function updateAuthor(index: number, patch: Partial<PublicationAuthor>) {
    const next = [...value.authors];
    next[index] = { ...next[index], ...patch };
    set("authors", next);
  }
  function removeAuthor(index: number) {
    set("authors", value.authors.filter((_, i) => i !== index));
  }
  function addAuthor() {
    set("authors", [...value.authors, emptyAuthor()]);
  }

  const hasResearchDomainAndSdg = value.type !== "TEXT_BOOK";
  const hasCollaborationFields = value.type !== "TEXT_BOOK";
  const indexOptions = INDEX_OPTIONS_BY_TYPE[value.type];

  return (
    <div className="space-y-5">
      {value.type !== "TEXT_BOOK" && (
        <div className="space-y-1.5 rounded-lg border bg-muted/20 p-3">
          <Label>Fetch details from DOI</Label>
          <div className="flex gap-2">
            <Input
              value={doiInput}
              onChange={(e) => setDoiInput(e.target.value)}
              placeholder="10.nnnnnnn/example (bare DOI, not the full link)"
            />
            <Button type="button" variant="outline" onClick={() => void handleFetchDoi()} loading={doiFetchState === "loading"}>
              Fetch
            </Button>
          </div>
          {doiFetchState === "not-found" && <p className="text-xs text-destructive">Could not fetch details for that DOI</p>}
        </div>
      )}
    <div className="grid grid-cols-1 gap-x-8 gap-y-5 lg:grid-cols-2">
    <div className="space-y-5">
      <div className="space-y-1.5">
        <Label>Type of Publication <span className="text-destructive">*</span></Label>
        <Select value={value.type} onValueChange={(v) => setType(v as PublicationType)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {(Object.keys(PUBLICATION_TYPE_LABELS) as PublicationType[]).map((t) => <SelectItem key={t} value={t}>{PUBLICATION_TYPE_LABELS[t]}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label>{value.type === "TEXT_BOOK" ? "Title of the Book" : "Title of the Paper"} <span className="text-destructive">*</span></Label>
        <Input value={value.title} onChange={(e) => set("title", e.target.value)} placeholder="Title" />
      </div>

      {hasResearchDomainAndSdg && (
        <>
          <div className="space-y-1.5">
            <Label>Research Domain <span className="text-destructive">*</span></Label>
            <Input value={value.researchDomain ?? ""} onChange={(e) => set("researchDomain", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>SDG Mapped <span className="text-destructive">*</span></Label>
            <SdgPicker selected={value.sdgGoals} onChange={(v) => set("sdgGoals", v)} />
          </div>
        </>
      )}

      {value.type === "JOURNAL" && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Name of the Journal <span className="text-destructive">*</span></Label>
            <Input value={value.journalName ?? ""} onChange={(e) => set("journalName", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>ISSN Number <span className="text-destructive">*</span></Label>
            <Input type="number" value={value.issnNumber ?? ""} onChange={(e) => set("issnNumber", e.target.value)} />
          </div>
        </div>
      )}

      {value.type === "CONFERENCE" && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Name of the Conference <span className="text-destructive">*</span></Label>
            <Input value={value.conferenceName ?? ""} onChange={(e) => set("conferenceName", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Organized By <span className="text-destructive">*</span></Label>
            <Input value={value.organizedBy ?? ""} onChange={(e) => set("organizedBy", e.target.value)} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>ISBN Number <span className="text-destructive">*</span></Label>
            <Input type="number" value={value.isbnNumber ?? ""} onChange={(e) => set("isbnNumber", e.target.value)} />
          </div>
        </div>
      )}

      {value.type === "BOOK_CHAPTER" && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Name of the Book <span className="text-destructive">*</span></Label>
            <Input value={value.bookName ?? ""} onChange={(e) => set("bookName", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>ISBN Number <span className="text-destructive">*</span></Label>
            <Input type="number" value={value.isbnNumber ?? ""} onChange={(e) => set("isbnNumber", e.target.value)} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Is this extension of Conference?</Label>
            <YesNoToggle value={value.isExtensionOfConference} onChange={(v) => set("isExtensionOfConference", v)} />
          </div>
        </div>
      )}

      {value.type === "TEXT_BOOK" && (
        <div className="space-y-1.5">
          <Label>ISBN Number</Label>
          <Input type="number" value={value.isbnNumber ?? ""} onChange={(e) => set("isbnNumber", e.target.value)} />
        </div>
      )}

      <div className="space-y-1.5">
        <Label>Name of the Publisher {value.type !== "TEXT_BOOK" && <span className="text-destructive">*</span>}</Label>
        <Input value={value.publisherName ?? ""} onChange={(e) => set("publisherName", e.target.value)} />
      </div>

      {value.type === "TEXT_BOOK" && (
        <div className="space-y-1.5">
          <Label>Is the Publisher listed in the R&amp;D policy Annexure?</Label>
          <YesNoToggle value={value.isPublisherInRnDPolicyAnnexure} onChange={(v) => set("isPublisherInRnDPolicyAnnexure", v)} />
        </div>
      )}

      {indexOptions.length > 0 && (
        <div className="space-y-1.5">
          <Label>Indexed <span className="text-destructive">*</span></Label>
          <MultiCheckboxGroup options={indexOptions} labels={INDEX_LABELS} urls={INDEX_REFERENCE_URLS} selected={value.indexedIn} onChange={(v) => set("indexedIn", v)} />
        </div>
      )}

      {value.type === "JOURNAL" && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>
              Quartile <span className="text-destructive">*</span>{" "}
              <a href={QUARTILE_REFERENCE_URL} target="_blank" rel="noopener noreferrer" className="text-xs font-normal text-primary hover:underline">({QUARTILE_REFERENCE_URL})</a>
            </Label>
            <Select value={value.quartile ?? ""} onValueChange={(v) => set("quartile", v as PublicationQuartile)}>
              <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                {QUARTILE_OPTIONS.map((q) => <SelectItem key={q} value={q}>{q}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>
              Impact Factor{" "}
              <a href={IMPACT_FACTOR_REFERENCE_URL} target="_blank" rel="noopener noreferrer" className="text-xs font-normal text-primary hover:underline">({IMPACT_FACTOR_REFERENCE_URL})</a>
            </Label>
            <Input type="number" step="0.01" value={value.impactFactor ?? ""} onChange={(e) => set("impactFactor", e.target.value)} />
          </div>
        </div>
      )}

    </div>
    <div className="space-y-5">
      <div className="space-y-3 rounded-lg border p-3">
        <div className="flex items-center justify-between">
          <Label>Authors</Label>
          <span className="text-xs text-muted-foreground">{internalCount} Internal &middot; {externalCount} External</span>
        </div>
        {value.authors.length === 0 && <p className="text-xs text-muted-foreground">No authors added yet.</p>}
        {value.authors.map((author, i) => (
          <div key={i} className="space-y-2 rounded-md border bg-muted/20 p-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Author {i + 1}</p>
              <Button type="button" variant="ghost" size="sm" onClick={() => removeAuthor(i)}>
                <Trash2 className="h-3.5 w-3.5 text-destructive" />
              </Button>
            </div>
            <AuthorFields
              author={author}
              update={(patch) => updateAuthor(i, patch)}
              colleges={colleges}
              ownCollegeId={ownCollegeId}
            />
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" onClick={addAuthor}>Add Author</Button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Month &amp; Year of Publication {value.type !== "BOOK_CHAPTER" && value.type !== "TEXT_BOOK" && <span className="text-destructive">*</span>}</Label>
          <Input type="month" value={value.monthYearOfPublication ?? ""} onChange={(e) => set("monthYearOfPublication", e.target.value)} />
        </div>
        {(value.type === "JOURNAL" || value.type === "CONFERENCE") && (
          <div className="space-y-1.5">
            <Label>Month &amp; Year of Index <span className="text-destructive">*</span></Label>
            <Input type="month" value={value.monthYearOfIndex ?? ""} onChange={(e) => set("monthYearOfIndex", e.target.value)} />
          </div>
        )}
      </div>

      {value.type !== "TEXT_BOOK" && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Scopus/WoS Link of the Paper <span className="text-destructive">*</span></Label>
            <Input value={value.scopusOrWosLink ?? ""} onChange={(e) => set("scopusOrWosLink", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Published Paper Link <span className="text-destructive">*</span></Label>
            <Input value={value.publishedPaperLink ?? ""} onChange={(e) => set("publishedPaperLink", e.target.value)} />
          </div>
        </div>
      )}

      {value.type === "TEXT_BOOK" && (
        <div className="space-y-1.5">
          <Label>Provide link of the Book</Label>
          <Input value={value.providedBookLink ?? ""} onChange={(e) => set("providedBookLink", e.target.value)} />
        </div>
      )}

      <div className="space-y-1.5">
        <Label>DoI</Label>
        <Input value={value.doi ?? ""} onChange={(e) => set("doi", e.target.value)} />
      </div>

      <div className="space-y-1.5">
        <Label>Cite the paper as <span className="text-destructive">*</span></Label>
        <Textarea
          value={value.citeAs ?? ""}
          onChange={(e) => set("citeAs", e.target.value)}
          placeholder="Author details, title of the paper, name of the journal/conference/book, Vol., Issue, PP, Year, DoI"
          rows={2}
        />
      </div>

      {hasCollaborationFields && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Any International Collaboration? <span className="text-destructive">*</span></Label>
            <YesNoToggle value={value.hasInternationalCollaboration} onChange={(v) => set("hasInternationalCollaboration", v)} />
          </div>
          <div className="space-y-1.5">
            <Label>Any Industry Collaboration? <span className="text-destructive">*</span></Label>
            <YesNoToggle value={value.hasIndustryCollaboration} onChange={(v) => set("hasIndustryCollaboration", v)} />
          </div>
        </div>
      )}
    </div>
    </div>
    </div>
  );
}
