# Flow — M2-F4: Demo Day & Panel Scoring

- **Flow ID:** M2-F4
- **Actors:** HOD (setup/review), coordinator faculty, panel members, Principal/VP (locked-in), candidate (demo)
- **Trigger:** batch phase INTERVIEW_READY; interview date arrives
- **Preconditions:** panel set (`panelMemberUids`), venue/coordinator (offline) or platform/link (online); positionCategory TEACHING for demo flow
- **Main success scenario:**
  1. Demo day: coordinator opens QR session (`/coordinator/[batchId]`) → phase IN_PROGRESS.
  2. Candidates demo; each panelist records demoRatings (6 criteria EXCELLENT/GOOD/AVERAGE/POOR) + demoOverallScore 1-10 via `/evaluation/[batchId]/[candidateId]` (recruitment.ts:365-378).
  3. HOD reviews demo scores → phase PANEL_INTERVIEW.
  4. Panelists record panelScores (7 criteria 1-10; `communication`/`ictTools` optional — tolerate missing in averages, comment :380-386) + ratings 1-5 (:399+).
  5. HOD/Principal advance → PRINCIPAL_FINAL_REVIEW → decisions → COMPLETED.
- **Alternate/error:** online mode skips demo-classroom/venue requirements; SUPPORTING_STAFF skips demo entirely (comment :313-317); student demo feedback (studentFeedback collection) skipped for ONLINE `[UNVERIFIED gating]`; panelist not in batch.panelMemberUids → 403.
- **UI:** `/hod/batches`, `/hod/batches/[id]`, `/hod/batches/new`, `/panel/interviews`, `/evaluation/[batchId]/[candidateId]`, `/coordinator/[batchId]`, `/location-interview/[id]`.
- **API:** `api/college/hiring-batches` + `[id]` (phase transitions), `api/college/panel-feedback`, `api/location/interviews` + `[id]`.
- **Backend:** inline + notify (excludeLeadershipUids for prompts; hiring-batches callsites).
- **DB:** `hiringBatches` (+`panelFeedback` subcollection), `studentFeedback` (demo feedback, indexes exist).
- **Permissions:** panel membership check `[UNVERIFIED route-level]`; leadership locked into every panel (notify.ts:44-53 comment).
- **Validation:** rating enums/ranges; one feedback doc per (candidate, panelist).
- **State transitions:** batch phases per recruitment.ts:284-294; interviewSubStage PANEL_IN_PROGRESS→INTERVIEW_DONE (:71-76).
- **Side effects:** notifications (candidate arrived, scoring open, feedback unlocked); audit `[UNVERIFIED]`.
- **Reports:** candidate-profile averages (tolerating missing criteria); demo/panel sheets (paper parity naming in comments).
- **Concurrency:** upsert keyed (candidate, panelist) → idempotent overwrite `[ASSUMPTION from doc id]`; concurrent phase flips — last write wins `[GAP — verify optimistic lock]`.
- **Code evidence:** recruitment.ts:359-430; hiring-batches notify callsites; evaluation/coordinator page routes.
