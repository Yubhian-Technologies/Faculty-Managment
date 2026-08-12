# Panel Member — College Hiring Role

See [../college-pipeline.md](../college-pipeline.md) for the full sequence this fits into, and [../README.md](../README.md) for the flow notation.

## Scope & pipeline position

Panel Member is a pure scorer. It only sees a batch once the HOD advances `currentPhase` to `PANEL_INTERVIEW`, and its only real write is submitting scores — those feed the Principal's decision screen but are **never aggregated automatically**. If a panelist is also assigned as the demo Coordinator, they get one extra action: marking the demo complete.

## Pages

`src/app/(dashboard)/panel/...`
- `interviews/page.tsx`, `interviews/[id]/page.tsx` — score a candidate
- `/coordinator/[batchId]` — shared with `HOD`, used only if this panelist is the assigned demo coordinator
- `/evaluation/[batchId]/[candidateId]` — shared demo/scoring page

## Actions

| Action | API call | Guard | Effect | Notifications / audit |
|---|---|---|---|---|
| Score a candidate | `POST /api/college/panel-feedback` | `PANEL_MEMBER, PRINCIPAL, VICE_PRINCIPAL, HOD, SUPER_ADMIN`; further restricted server-side to the batch's assigned `panelMemberUids` | Upserted `panelFeedback` doc (`demoRatings` / `panelScores` / legacy `ratings+recommendation`), transactionally merged per (candidate, panelist) | audit `FEEDBACK_SUBMITTED` |
| Mark demo complete (if assigned Coordinator) | `PATCH /api/college/hiring-batches/[id]` (`demoComplete: true`) | restricted to `isAssignedCoordinator \|\| isOwnerHod \|\| isPrincipalRole` | `HiringBatch{currentPhase: IN_PROGRESS}` | Notifies HOD + panel |
| View own submitted feedback | — | filtered client-side to the caller's own docs | — | — |

## Notes

- Scoring is only open while `currentPhase` is `PANEL_INTERVIEW`, `PRINCIPAL_FINAL_REVIEW`, or `COMPLETED` — a panelist can't score before the HOD opens the phase, but can still submit/amend after the batch closes.
- Three scoring modules exist in the same `panelFeedback` doc shape: a demo rubric (6 criteria, `EXCELLENT/GOOD/AVERAGE/POOR`), the active panel-evaluation form (5 criteria, 1–10), and a legacy interview module (3 criteria, 1–5, plus an `ACCEPT/REJECT/MAYBE` recommendation). Which one a given batch's UI presents depends on the interview stage, not the panelist's choice.
- An `HOD` who is also listed as a panelist is redirected off `/panel/interviews/[id]` straight to their own `/hod/batches/[id]` — the HOD's batch page absorbs the panelist scoring view rather than duplicating it.
- Panel Member has no visibility into vacancy approval, offer letters, or anything past the decision stage — its role in the pipeline ends once feedback is submitted.
