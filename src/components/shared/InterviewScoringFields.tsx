"use client";

import { Label } from "@/components/ui/label";

export const RATING_LABELS = ["", "Poor", "Fair", "Satisfactory", "Good", "Excellent"];

export const PANEL_CRITERIA = [
  { key: "subjectKnowledge" as const,    label: "Subject Knowledge & Technical Competence",       weight: "20%" },
  { key: "teachingMethodology" as const, label: "Teaching Methodology & Content Delivery",         weight: "20%" },
  { key: "communicationSkills" as const, label: "Communication Skills",                            weight: "10%" },
  { key: "researchProfile" as const,     label: "Research, Academic & Technical Profile",          weight: "10%" },
  { key: "professionalism" as const,     label: "Professionalism, Confidence & Overall Suitability", weight: "10%" },
] as const;

export const STUDENT_CRITERIA = [
  { key: "studentSubjectKnowledge" as const,    label: "Subject Knowledge & Preparedness",        weight: "6%" },
  { key: "studentClarityOfTeaching" as const,   label: "Clarity of Teaching",                     weight: "6%" },
  { key: "studentCommunication" as const,        label: "Communication & Presentation Skills",     weight: "6%" },
  { key: "studentClassroomResources" as const,   label: "Effective Use of Classroom Resources",   weight: "6%" },
  { key: "studentOverallEffectiveness" as const, label: "Overall Effectiveness",                   weight: "6%" },
] as const;

export type PanelKey = typeof PANEL_CRITERIA[number]["key"];
export type StudentKey = typeof STUDENT_CRITERIA[number]["key"];
export type ScoringKey = PanelKey | StudentKey;

export interface ScoreFormValues {
  subjectKnowledge: number;
  teachingMethodology: number;
  communicationSkills: number;
  researchProfile: number;
  professionalism: number;
  studentSubjectKnowledge: number;
  studentClarityOfTeaching: number;
  studentCommunication: number;
  studentClassroomResources: number;
  studentOverallEffectiveness: number;
}

export const EMPTY_SCORES: ScoreFormValues = {
  subjectKnowledge: 0, teachingMethodology: 0, communicationSkills: 0, researchProfile: 0, professionalism: 0,
  studentSubjectKnowledge: 0, studentClarityOfTeaching: 0, studentCommunication: 0, studentClassroomResources: 0, studentOverallEffectiveness: 0,
};

export function calcPanelScore(v: ScoreFormValues): number {
  return ((v.subjectKnowledge + v.teachingMethodology + v.communicationSkills + v.researchProfile + v.professionalism) / 25) * 70;
}
export function calcStudentScore(v: ScoreFormValues): number {
  return ((v.studentSubjectKnowledge + v.studentClarityOfTeaching + v.studentCommunication + v.studentClassroomResources + v.studentOverallEffectiveness) / 25) * 30;
}
export function isPanelFilled(v: ScoreFormValues): boolean {
  return PANEL_CRITERIA.every((c) => v[c.key] > 0);
}
export function isStudentFilled(v: ScoreFormValues): boolean {
  return STUDENT_CRITERIA.every((c) => v[c.key] > 0);
}

function RatingPicker({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex gap-1.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          title={RATING_LABELS[n]}
          className={`flex-1 py-1.5 rounded border text-center transition-colors ${
            value === n
              ? "bg-primary text-primary-foreground border-primary"
              : "bg-muted text-muted-foreground hover:bg-primary/10 border-transparent"
          }`}
        >
          <span className="block text-xs font-bold">{n}</span>
          <span className="block text-[10px] leading-tight">{RATING_LABELS[n]}</span>
        </button>
      ))}
    </div>
  );
}

interface Props {
  values: ScoreFormValues;
  onChange: (key: ScoringKey, value: number) => void;
}

export function InterviewScoringFields({ values, onChange }: Props) {
  const panelScore = calcPanelScore(values);
  const studentScore = calcStudentScore(values);
  const showScore = panelScore > 0 || studentScore > 0;

  return (
    <div className="space-y-5">
      {/* Panel Evaluation */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 pb-1.5 border-b">
          <span className="text-sm font-semibold">Panel Evaluation</span>
          <span className="text-xs bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded">70%</span>
          {panelScore > 0 && (
            <span className="ml-auto text-sm font-bold text-primary">
              {panelScore.toFixed(1)}<span className="text-xs font-normal text-muted-foreground">/70</span>
            </span>
          )}
        </div>
        {PANEL_CRITERIA.map((c) => (
          <div key={c.key} className="space-y-1.5">
            <Label className="text-xs flex items-center justify-between gap-2">
              <span>{c.label}</span>
              <span className="text-muted-foreground shrink-0">{c.weight}</span>
            </Label>
            <RatingPicker value={values[c.key]} onChange={(v) => onChange(c.key, v)} />
          </div>
        ))}
      </div>

      {/* Student Feedback */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 pb-1.5 border-b">
          <span className="text-sm font-semibold">Student Feedback</span>
          <span className="text-xs bg-green-50 text-green-700 border border-green-200 px-2 py-0.5 rounded">30%</span>
          {studentScore > 0 && (
            <span className="ml-auto text-sm font-bold text-primary">
              {studentScore.toFixed(1)}<span className="text-xs font-normal text-muted-foreground">/30</span>
            </span>
          )}
        </div>
        {STUDENT_CRITERIA.map((c) => (
          <div key={c.key} className="space-y-1.5">
            <Label className="text-xs flex items-center justify-between gap-2">
              <span>{c.label}</span>
              <span className="text-muted-foreground shrink-0">{c.weight}</span>
            </Label>
            <RatingPicker value={values[c.key]} onChange={(v) => onChange(c.key, v)} />
          </div>
        ))}
      </div>

      {/* Live score preview */}
      {showScore && (
        <div className="rounded-lg bg-primary/5 border border-primary/20 p-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Overall Score</span>
            <span className="text-xl font-bold text-primary">
              {(panelScore + studentScore).toFixed(1)}
              <span className="text-sm font-normal text-muted-foreground">/100</span>
            </span>
          </div>
          <div className="flex gap-4 mt-1 text-xs text-muted-foreground">
            <span>Panel: {panelScore.toFixed(1)}/70</span>
            <span>Student Feedback: {studentScore.toFixed(1)}/30</span>
          </div>
        </div>
      )}
    </div>
  );
}
