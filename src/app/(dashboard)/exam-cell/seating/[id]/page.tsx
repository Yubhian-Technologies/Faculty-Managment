"use client";

import { neutraliseFormula } from "@/lib/utils/csv";
import { use, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Download, FileText, Printer, Save, Send, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { toast } from "@/hooks/useToast";
import { moveStudent, rollRangeBySection } from "@/lib/exams/seatingAllocator";
import { benchRows, moveStudentLayered } from "@/lib/exams/seatingLayers";
import { AllotSectionPanel } from "@/components/exams/AllotSectionPanel";
import { SEAT_LETTERS } from "@/lib/exams/seatingPaired";
import { SeatingTimingCheck } from "@/components/exams/SeatingTimingCheck";
import { fetchCollegeLogoUrl } from "@/lib/pdf/logo";
import { renderHtmlToPdf, renderMultiHtmlToPdf } from "@/lib/pdf/htmlToPdf";
import { noticeBoardHTML, roomSheetHTML, seatingWhen, signatureSheetsHTML, type SheetExam } from "@/lib/pdf/examSeatingTemplate";
import { examLine, type ExamOf } from "@/lib/pdf/examHeader";
import { ordinalYearLabel } from "@/lib/college/courseYears";
import type { MidExamPlan, MidTimetable } from "@/types";
import type { ExamSeatingPlan } from "@/types/examSeating";

// Review of an automatic allotment: every room with its roll-number ranges,
// each student movable to another room (capacity enforced), anyone unplaced
// listed on top, then save / publish / print / CSV.
export default function SeatingPlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [plan, setPlan] = useState<ExamSeatingPlan | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pdfBusy, setPdfBusy] = useState<string | null>(null);

  function reload() {
    fetch(`/api/college/exam-seating/${id}`)
      .then((r) => r.json() as Promise<{ plan?: ExamSeatingPlan }>)
      .then((d) => { setPlan(d.plan ?? null); setDirty(false); })
      .catch(() => toast({ variant: "destructive", title: "Failed to load the plan" }));
  }
  useEffect(reload, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!plan) return <div className="h-40 rounded-lg border bg-muted/30 animate-pulse" />;

  const published = plan.status === "PUBLISHED";
  // Paired plans show bench-wise like layered ones; their seats are fixed by the build (rebuild to change).
  const paired = plan.mode === "PAIRED";
  const layered = plan.mode === "LAYERED" || paired;
  const deptBySection = new Map(plan.sections.map((s) => [s.id, s.department]));

  function move(studentId: string, target: string) {
    if (layered) {
      const res = moveStudentLayered(plan!.rooms, studentId, target, (sid) => deptBySection.get(sid) ?? "");
      if ("error" in res) { toast({ variant: "destructive", title: res.error }); return; }
      setPlan({ ...plan!, rooms: res.rooms });
      setDirty(true);
      return;
    }
    const next = moveStudent(plan!, studentId, target);
    if (!next) { toast({ variant: "destructive", title: "That room is full" }); return; }
    setPlan({ ...plan!, ...next });
    setDirty(true);
  }

  async function patch(body: Record<string, unknown>, okMessage: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/college/exam-seating/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to save");
      toast({ variant: "success", title: okMessage });
      setDirty(false);
      return true;
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to save" });
      return false;
    } finally {
      setBusy(false);
    }
  }

  const edits = () => ({ rooms: plan.rooms, unplaced: plan.unplaced });

  async function publish() {
    if (await patch({ ...edits(), status: "PUBLISHED" }, "Seating plan published")) setPlan({ ...plan!, status: "PUBLISHED" });
  }

  async function remove() {
    await fetch(`/api/college/exam-seating/${id}`, { method: "DELETE" });
    router.push("/exam-cell/seating");
  }

  function downloadCsv() {
    const lines = [["Room", "Block", "Floor", layered ? "Bench" : "Seat", "Regd. No", "Name", "Section"]];
    for (const r of plan!.rooms) {
      if (layered) {
        benchRows(r).forEach((row, b) => row.forEach((s, l) => {
          if (s) lines.push([r.name, r.block, String(r.floor), `${b + 1}${String.fromCharCode(65 + l)}`, s.rollNumber, s.name, s.sectionLabel]);
        }));
      } else {
        r.students.forEach((s, i) => lines.push([r.name, r.block, String(r.floor), String(i + 1), s.rollNumber, s.name, s.sectionLabel]));
      }
    }
    const csv = lines.map((l) => l.map((c) => `"${neutraliseFormula(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `${plan!.name.replace(/[^a-z0-9]+/gi, "-")}-seating.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const usedRooms = plan.rooms.filter((r) => r.students.length > 0);

  /** Each group's exams (date, time, subjects) from the Mid timetable(s) the plan was built from. */
  async function examsByGroup(): Promise<((group: string) => SheetExam[]) | undefined> {
    if (!plan) return undefined;
    // Plans built before they recorded their Mid timetable: look through every Mid
    // timetable (groups are matched by branch + year), limited to the plan's date if it has one.
    let ids = plan.midPlanIds ?? [];
    if (ids.length === 0) {
      const list = await fetch("/api/college/mid-timetables").then((r) => (r.ok ? r.json() : {})).catch(() => ({})) as { plans?: { id: string }[] };
      ids = (list.plans ?? []).map((x) => x.id);
    }
    const onlyDate = plan.midPlanIds?.length ? null : plan.examDate ?? null;
    const map = new Map<string, SheetExam[]>();
    for (const id of ids) {
      const res = await fetch(`/api/college/mid-timetables/${encodeURIComponent(id)}`);
      if (!res.ok) continue;
      const d = (await res.json()) as { plan: MidExamPlan; branches: { branch: string; timetable: MidTimetable | null }[] };
      for (const b of d.branches) {
        if (!b.timetable) continue;
        const group = `${b.branch} (${ordinalYearLabel(d.plan.year)})`; // as the plan's groups are named
        const exams = new Map<string, SheetExam>();
        for (const sl of b.timetable.slots) {
          if (onlyDate && sl.date !== onlyDate) continue;
          const ses = d.plan.sessions.find((x) => x.id === sl.sessionId) ?? b.timetable.sessions.find((x) => x.id === sl.sessionId);
          const key = `${sl.date}|${sl.sessionId}`;
          const e = exams.get(key) ?? { date: sl.date, time: ses ? `${ses.from}-${ses.to}` : "", subjects: [] };
          e.subjects.push({ name: sl.subjectName, code: sl.subjectCode });
          exams.set(key, e);
        }
        map.set(group, [...(map.get(group) ?? []), ...exams.values()]);
      }
    }
    return map.size ? (group) => map.get(group) ?? [] : undefined;
  }

  async function pdf(kind: "rooms" | "notice" | "attendance") {
    setPdfBusy(kind);
    try {
      const [info, logoUrl] = await Promise.all([
        fetch("/api/college/info").then((r) => (r.ok ? r.json() : {})).catch(() => ({})) as Promise<{ name?: string; academicYear?: string }>,
        fetchCollegeLogoUrl(),
      ]);
      // The exam line(s) of the Mid timetable(s) seated: "I B.TECH. I SEMESTER MID-1 EXAMINATION".
      const exams = (await Promise.all((plan!.midPlanIds ?? []).map((mid) => fetch(`/api/college/mid-timetables/${encodeURIComponent(mid)}`)
        .then((r) => (r.ok ? (r.json() as Promise<{ exam?: ExamOf }>) : {})).then((d: { exam?: ExamOf }) => d.exam ?? null).catch(() => null)))).filter((x): x is ExamOf => Boolean(x));
      const c = { name: info.name || "College", logoUrl, examLines: [...new Set(exams.map(examLine))], academicYear: info.academicYear, courseCode: exams[0]?.courseCode };
      const base = plan!.name.replace(/[^a-z0-9]+/gi, "-");
      if (kind === "notice") await renderHtmlToPdf(noticeBoardHTML(c, plan!), `${base}-notice-board.pdf`);
      else if (kind === "rooms") await renderMultiHtmlToPdf(usedRooms.map((r) => roomSheetHTML(c, plan!, r)), `${base}-room-sheets.pdf`);
      else await renderMultiHtmlToPdf(signatureSheetsHTML(c, plan!, await examsByGroup()), `${base}-signature-sheets.pdf`);
    } catch {
      toast({ variant: "destructive", title: "Could not make the PDF" });
    } finally {
      setPdfBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="print:hidden space-y-4">
        <Link href="/exam-cell/seating" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> All plans
        </Link>
        <PageHeader
          title={plan.name}
          description={`${seatingWhen(plan) ? `${seatingWhen(plan)} · ` : ""}${plan.rooms.reduce((n, r) => n + r.students.length, 0)} students seated in ${usedRooms.length} rooms`}
          actions={
            <>
              <Badge variant={published ? "approved" : "pending"}>{published ? "Published" : "Draft"}</Badge>
              <Button size="sm" variant="outline" onClick={downloadCsv}><Download className="h-4 w-4 mr-1" /> CSV</Button>
              <Button size="sm" variant="outline" onClick={() => window.print()}><Printer className="h-4 w-4 mr-1" /> Print</Button>
              <Button size="sm" variant="outline" loading={pdfBusy === "rooms"} disabled={usedRooms.length === 0} onClick={() => void pdf("rooms")}><FileText className="h-4 w-4 mr-1" /> Room sheets</Button>
              <Button size="sm" variant="outline" loading={pdfBusy === "notice"} disabled={usedRooms.length === 0} onClick={() => void pdf("notice")}><FileText className="h-4 w-4 mr-1" /> Notice board</Button>
              <Button size="sm" variant="outline" loading={pdfBusy === "attendance"} disabled={usedRooms.length === 0} onClick={() => void pdf("attendance")}><FileText className="h-4 w-4 mr-1" /> Signature sheets</Button>
              <Button size="sm" variant="outline" disabled={!dirty} loading={busy} onClick={() => void patch(edits(), "Changes saved")}>
                <Save className="h-4 w-4 mr-1" /> Save
              </Button>
              {!published && (
                <Button size="sm" disabled={plan.unplaced.length > 0 || usedRooms.length === 0} loading={busy} onClick={() => void publish()}>
                  <Send className="h-4 w-4 mr-1" /> Publish
                </Button>
              )}
              <Button size="icon" variant="ghost" aria-label="Delete plan" onClick={() => setConfirmDelete(true)}><Trash2 className="h-4 w-4" /></Button>
            </>
          }
        />

        {plan.mode === "LAYERED" && !published && <AllotSectionPanel plan={plan} onAllotted={reload} />}
        {paired && (plan.midPlanIds ?? []).length > 0 && <SeatingTimingCheck planId={plan.id} reloadKey={plan.status} />}
        {paired && plan.streams && (
          <Card>
            <CardContent className="flex flex-wrap gap-x-6 gap-y-1 p-4 text-sm">
              {plan.streams.map((st) => (
                <span key={st.seat}><span className="font-semibold">Seat {SEAT_LETTERS[st.seat - 1]}:</span> {st.groups.map((g) => `${g.label} (${g.count})`).join(" → ")}</span>
              ))}
              <span className="w-full text-xs text-muted-foreground">Seats are set by the build - to change them, delete this draft and build again.</span>
            </CardContent>
          </Card>
        )}

        {plan.unplaced.length > 0 && (
          <Card className="border-destructive/50">
            <CardContent className="p-4 space-y-2">
              <p className="text-sm font-medium text-destructive">{plan.unplaced.length} student(s) have no seat - {paired ? "the rooms picked are full: delete this draft and build again with more rooms." : "move them into a room with space (or add a room by building a new plan)."}</p>
              {plan.unplaced.map((s) => (
                <div key={s.id} className="flex items-center justify-between gap-2 text-sm">
                  <span>{s.rollNumber} · {s.name} <span className="text-xs text-muted-foreground">{s.sectionLabel}</span></span>
                  {!paired && <MoveSelect plan={plan} current="UNPLACED" onMove={(t) => move(s.id, t)} />}
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>

      {usedRooms.map((room) => (
        <Card key={room.roomId} className="print:break-after-page print:shadow-none print:border-0">
          <CardContent className="p-4 space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <p className="text-lg font-semibold">Room {room.name}</p>
                <p className="text-xs text-muted-foreground">Block {room.block} · Floor {room.floor} · {plan.name}</p>
              </div>
              <p className="text-sm text-muted-foreground">
                {room.students.length} / {room.capacity} seats{layered ? ` · ${room.benches ?? room.capacity} benches × ${room.perBench ?? 1}` : ""}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {rollRangeBySection(room.students).map((g) => (
                <Badge key={g.sectionLabel} variant="outline" className="font-normal">
                  {g.sectionLabel}: {g.from} – {g.to} ({g.count})
                </Badge>
              ))}
            </div>
            {layered ? (
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground border-b">
                  <tr>
                    <th className="py-1.5 w-14">Bench</th>
                    {Array.from({ length: room.perBench ?? 1 }, (_, l) => <th key={l}>Seat {String.fromCharCode(65 + l)}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {benchRows(room).map((row, b) => (
                    <tr key={b} className="border-b last:border-0 align-top">
                      <td className="py-1.5">{b + 1}</td>
                      {row.map((s, l) => (
                        <td key={l} className="py-1.5 pr-3">
                          {s ? (
                            <div className="flex items-center justify-between gap-2">
                              <span>
                                {s.rollNumber} · {s.name}
                                <span className="block text-[11px] text-muted-foreground">{s.sectionLabel}</span>
                              </span>
                              {!published && !paired && <span className="print:hidden"><MoveSelect plan={plan} current={room.roomId} onMove={(t) => move(s.id, t)} /></span>}
                            </div>
                          ) : <span className="text-muted-foreground">-</span>}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground border-b">
                <tr><th className="py-1.5 w-12">Seat</th><th>Regd. No.</th><th>Name</th><th>Section</th><th className="print:hidden text-right">Move to</th></tr>
              </thead>
              <tbody>
                {room.students.map((s, i) => (
                  <tr key={s.id} className="border-b last:border-0">
                    <td className="py-1.5">{i + 1}</td>
                    <td>{s.rollNumber}</td>
                    <td>{s.name}</td>
                    <td className="text-xs text-muted-foreground">{s.sectionLabel}</td>
                    <td className="print:hidden text-right"><MoveSelect plan={plan} current={room.roomId} onMove={(t) => move(s.id, t)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            )}
          </CardContent>
        </Card>
      ))}

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this seating plan?"
        description="This can't be undone."
        confirmLabel="Delete"
        onConfirm={() => void remove()}
      />
    </div>
  );
}

function MoveSelect({ plan, current, onMove }: { plan: ExamSeatingPlan; current: string; onMove: (target: string) => void }) {
  return (
    <Select value="" onValueChange={onMove}>
      <SelectTrigger className="h-7 w-36 text-xs"><SelectValue placeholder="Move…" /></SelectTrigger>
      <SelectContent>
        {plan.rooms.filter((r) => r.roomId !== current).map((r) => (
          <SelectItem key={r.roomId} value={r.roomId} disabled={r.students.length >= r.capacity}>
            {r.name} ({r.students.length}/{r.capacity})
          </SelectItem>
        ))}
        {current !== "UNPLACED" && plan.mode !== "LAYERED" && <SelectItem value="UNPLACED">Unplaced</SelectItem>}
      </SelectContent>
    </Select>
  );
}
