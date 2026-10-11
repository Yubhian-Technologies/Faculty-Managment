# Principal Role: Complete Flow (as built in code)

Source of truth: `navConfig.ts`, `src/proxy.ts`, `src/app/(dashboard)/principal/**`, and the API guards in `src/app/api/**`.
Rule used throughout: **a thing is listed as allowed only if an API guard or page allows it.** Where the UI and the API disagree, that is flagged in section 10.

Legend: **V** = view, **C** = create, **E** = edit, **A** = approve, **R** = reject, **D** = delete.
"VP" = Vice Principal (shares almost every Principal page and API).

---

## 0. The idea in one minute (the "UKG" version)

The Principal is the **head of one college**. People below (HODs, faculty, office) **ask** for things. The Principal **looks** at the request and says **yes, no, or "fix it and send again"**. The system then **tells** the person who asked.
The Principal also **watches** (attendance, timetable, students, marks) and **sets up** some college rules (settings, who sits in which job seat).

Three kinds of things the Principal does:
1. **Decide**: hiring request, interview plan, candidate, leave, budget.
2. **Look**: students, timetable, marks, attendance, audit trail.
3. **Set up**: settings, role seats, departments/courses, circulars, holidays.

---

## 1. Start point

### 1.1 Who counts as "Principal"
| Login type | What happens |
|---|---|
| `PRINCIPAL` | Full Principal powers |
| `VICE_PRINCIPAL` | Same pages (plus own `/vice-principal` home and "General Admin Vacancies") |
| `COLLEGE_ADMIN`, `DIRECTOR` | Turned into `PRINCIPAL` at sign-in. They get the pages, but **cannot decide** hiring, leave or budget (API returns 403 "Only the Principal or Vice Principal can decide…"). Their personal pages (My Profile/Attendance/Leave) and Budget/Hiring/Leave Approvals/Purchase Clearance menu items are hidden |

### 1.2 Login steps
1. Open the login page.
2. Type email + password (Firebase Auth).
3. System calls `POST /api/auth/session`, which checks the token, finds role + college, and sets a signed 24-hour cookie `fms-session`.
4. Browser goes to `/principal` (from `ROLE_DASHBOARD_PATHS`). A `?redirect=` link is honoured if present.
5. `proxy.ts` only lets `/principal/*` (and a few shared paths: panel interviews, evaluation, candidate profile, leave adjustments) open for this role.

### 1.3 First screen: Dashboard (`/principal`)
Greeting "Hello, <first name>", then:
| Tile | Number shows | Click goes to |
|---|---|---|
| Pending Vacancies | vacancy requests with status PENDING | `/principal/vacancies` |
| Interviews & Decisions | hiring batches with status PENDING | `/principal/interviews` |
| Departments | top-level departments | `/principal/courses?tab=departments` |

Then two lists: **Pending Hiring Requests** (button Review) and **Pending Interview Plans** (button Review).
That is all the dashboard shows. There are no leave, budget or attendance tiles (see gaps).

### 1.4 Menu (sidebar) — the Super Admin can hide any item per college
| Section | Items |
|---|---|
| (top) | Dashboard |
| Academics | Courses (also Departments tab), Students (tabs Roster / Promotion / Graduated), Timetable View, Internal Marks |
| Staff & HR | Faculty, Staff, Circulars |
| Leave & Attendance | Leave Approvals, Leave History, Attendance, Attendance Reports |
| Hiring Pipeline | Hiring Requests (Interviews, Negotiate, Decisions, Appointment Letters are later steps inside it) |
| Budget & Purchase | Budget, Budget Report, Purchase Clearance, Budget History |
| Personal | My Profile, My Attendance, My Leave |
| Administration | Audit Logs, Role Assignments, Settings |

Menu hiding is cosmetic. Every action is protected again by its own API guard.

---

## 2. Permission summary (View / Manage / Approve / Reject / Final)

| Module | View | Create | Edit | Approve | Reject | Delete | Final decision? |
|---|---|---|---|---|---|---|---|
| Hiring Request (vacancy) | Yes | No | No | **Yes** | **Yes** | No | **Yes**, terminal |
| Interview plan (hiring batch) | Yes | No | Notes/status | **Yes** | **Yes** | No | Approve/Reject/Modify |
| Candidate (hire) | Yes | No | Negotiation terms | **Yes** | **Yes** | No | **Yes**, terminal |
| Appointment Letter | Yes | **Yes** (Principal/VP/Super Admin only) | No | n/a | n/a | No | Issues letter |
| Offer Letter | Yes | Yes (shared with Office) | status | n/a | n/a | No | Shared |
| Leave (staff, final stage) | Yes | No | No | **Yes** | **Yes** | No | **Yes** |
| Leave (HOD stage) | Yes | No | No | Yes (only when HOD-tier is stuck) | Yes | No | Yes |
| Budget Cycle | Yes | No | No | **Approve** | **Reject / Return** | No | Yes |
| Budget Request (HOD's) | Yes | No | No | **Verify (freeze)** | **Reject / Return** | No | Level 1 only; Finance is next |
| Emergency Budget (own) | Yes | **Yes** | Resubmit | No (Management approves) | n/a | No | No |
| Purchase Clearance | Yes (own emergency ones) | No (auto-created) | No | No | No | No | No |
| Circulars | Yes | Yes | Yes | no approval step exists | n/a | see gaps | Publish |
| Faculty | Yes | **Yes** | **Yes** | n/a | n/a | **Yes** | n/a |
| Staff / users | Yes | Yes | Yes | n/a | n/a | Yes (Principal/VP) | n/a |
| Departments | Yes | Yes | Yes | n/a | n/a | Yes | n/a |
| Courses | Yes | Yes (Principal & Super Admin, not VP) | Yes | n/a | n/a | n/a | n/a |
| Course Catalog | Yes | Yes | Yes | n/a | n/a | n/a | n/a |
| Sections | Yes | **No** (HOD only) | see 5 | n/a | n/a | n/a | n/a |
| Students | Yes | UI no / API yes | UI no / API yes | n/a | n/a | UI no / API yes | Promotion |
| Timetable | Yes (published) | UI no / API yes | UI no / API yes | n/a | n/a | n/a | Publish/reset: API only |
| Internal marks | Yes (read-only) | No | No | No | No | No | No |
| Attendance reports | Yes | Import / manual | n/a | n/a | n/a | n/a | n/a |
| Audit Logs | Yes (last 100) | No | No | No | No | No | No |
| Role Assignments (seats) | Yes | **Yes** | Yes | n/a | n/a | Remove | Assign / Vacate |
| Settings | Yes | n/a | **Yes** | n/a | n/a | n/a | n/a |
| Academic years/sessions, holidays, working days | Yes | Yes | Yes | n/a | n/a | Yes (years/sessions) | n/a |

**Cannot do** (verified in guards): decide anything as College Admin; create sections; mark/edit internal marks; create exam circulars (Exam Cell only); create Finance/Purchase approvals; approve their own leave or emergency budget (go to Management); decide a leave routed only to the other of Principal/VP; view another college.

---

## 3. Viewing flow (per module)

| Module | Opens | Shows | Filters | Click on a row | Read-only? |
|---|---|---|---|---|---|
| Dashboard | `/principal` | 3 counts + 2 pending lists | none | Review goes to the module | all |
| Courses/Departments | `/principal/courses` | departments, courses, years, timings | tab (Departments/Courses) | Department detail, edit pages | editable |
| Students | `/principal/students` | roster list, strength dashboard | course, department, year, section, search | student detail `/principal/students/[id]` | roster is browse-only in UI |
| Timetable View | `/principal/timetable` | published timetables only | course-year, section | grid | read-only |
| Internal Marks | `/principal/internal-marks` | marks by assignment | department etc. | detail dialog | read-only |
| Faculty | `/principal/faculty` | departments, then faculty list | department, search | profile modules (personal, academic, teaching load, ...) | editable |
| Staff | `/principal/staff` | non-faculty staff | search | profile modules | editable |
| Circulars | `/principal/circulars` | list of circulars | status | circular detail | editable |
| Leave Approvals | `/principal/leave-approvals` | queue of PENDING requests for this role | type/status | request detail with remarks box | decision buttons |
| Leave History | `/principal/leave-history` | by department, then person, then type | department, person, type | history rows | read-only |
| Attendance / Reports | `/principal/attendance-report`, `/attendance-reports` | daily staff check-in/out, absent, shortage, completion, faculty not posted, student attendance | date, department, course, section | per-person detail | read-only (import is an action) |
| Hiring Requests | `/principal/vacancies` | pipeline board by department/status | status, department | vacancy, then approve/reject pages | decision |
| Budget | `/principal/budget` | cycles + requests | status | `/budget/[id]` | decision |
| Budget Report | `/principal/budget/report` | totals | year | none | read-only |
| Purchase Clearance | `/principal/purchase-clearance` | only own emergency requests | status | `[id]` | read-only |
| Budget History | `/principal/indents` | indent history | status | `[id]` | read-only |
| Audit Logs | `/principal/audit-logs` | latest **100** events, newest first | none in API | none | read-only |
| Role Assignments | `/principal/role-assignments` | every seat and its holder | role | seat | managed |
| Settings | `/principal/settings` | College Information, Faculty Norms, Student Permissions, Leave Module, Leave Approval Routing, Vacation Staff, Leave Type Rules | none | edit and save | managed |
| My Profile / Attendance / Leave | personal pages | own data | none | none | own edit; hidden for College Admin |

---

## 4. Task flows (Start → Open → Select → View → Act → Save → Confirmation → Result)

### 4.1 Decide a Hiring Request (vacancy)
1. HOD raises a vacancy request (status PENDING).
2. Principal gets it on the dashboard tile and in Hiring Requests.
3. Open the request: position, department, required vs available, student strength, cadre ratio, HOD justification.
4. Choose **Approve** (`/vacancies/[id]/approve`) or **Reject** (`/vacancies/[id]/reject`, give reason). A "modify" status also exists in the API.
5. Save: `PATCH /api/college/vacancy-requests/[id]` writes `principalResponse` (who, when, reason, notes).
6. Notification goes to the department's HOD and Department Office head ("You may now collect candidates" or the reject reason). Audit log written.
7. **End:** APPROVED means HOD collects candidates. REJECTED ends it. Both are **final**; changing later returns 409.

### 4.2 Decide an Interview Plan (hiring batch)
1. HOD gathers candidates into a batch and submits it (batch PENDING, phase PRINCIPAL_REVIEW).
2. Principal opens Interviews, picks the batch (`/interviews/[id]`), reads candidates, panel, date.
3. Chooses **Approve / Reject / Modify** and adds notes.
4. `PATCH /api/college/hiring-batches/[id]`.
   - Approve: phase moves to HOD_FINAL_SETUP and the HOD is told to add venue, documents, demo room, coordinator.
   - Reject: HOD told, with notes. Modify: HOD told to fix and resubmit.
5. Phases then run without the Principal: HOD_FINAL_SETUP, INTERVIEW_READY, IN_PROGRESS, PANEL_INTERVIEW (demo and panel scoring), then **PRINCIPAL_FINAL_REVIEW** (all Principals are notified).

### 4.3 Salary negotiation and final decision on a candidate
1. Phase reaches PRINCIPAL_FINAL_REVIEW. Principal opens Negotiate (`/negotiate/[id]`).
2. Per candidate, enters expected and negotiated salary, date of joining (not in the past), terms and conditions, saves.
3. Opens Decisions (`/decisions/[id]`) and picks **Approve** or **Reject** per candidate. Approval **requires** a negotiated salary > 0 and a future joining date.
4. `PATCH /api/college/candidate-applications/[id]` (Principal/VP only, College Admin refused).
5. Candidate is notified in-app to the batch owner; the vacancy's filled count updates; when every candidate is decided the batch becomes COMPLETED.
6. **End:** decision is terminal (409 if flipped). Then the Principal issues the **Appointment Letter** (`/appointment-letters`, status SENT). The candidate accepts or rejects via the public offer-acceptance page; Office handles documents and joining.

### 4.4 Decide a Leave request
Who reaches the Principal:
- HOD forwards an **"Other"** leave (Maternity, Family Planning, Quarantine, Extraordinary, Compensatory) to PENDING_VICE_PRINCIPAL (Principal **or** VP can decide).
- A request the applicant routed to the Principal specifically is PENDING_PRINCIPAL (**Principal only**).
- Leaves from staff with no HOD stage start at the Principal/VP stage.
Steps:
1. Open Leave Approvals, pick a request: dates, days, reason, balance, who covers classes.
2. **Approve or Reject**. Approving an "Other" request requires choosing a leave category (Maternity needs female staff with at least 1 year of service).
3. `PATCH /api/leave/applications/[id]`. Approve commits the balance (excess becomes Loss of Pay); reject releases it. Both happen in one transaction.
4. Applicant is notified; substitutes are notified; approved leave syncs to attendance.
5. **End:** APPROVED or REJECTED. Principal/VP can also decide at the HOD stage when the HOD cannot (no sitting HOD). Cancel, edit and OD-proof verification also exist on the same route.
Own leave: the Principal's leave goes to **Management**, not here. VP cannot approve their own leave.

### 4.5 Budget Cycle
1. A budget cycle is opened (title, departments).
2. Principal opens Budget, selects the cycle, chooses **Approve / Reject / Return** (remarks mandatory for Reject and Return).
3. Approve creates a PENDING_SUBMISSION budget request for each department and notifies each HOD.
4. **End:** APPROVED (HODs fill requests), REJECTED, or RETURNED.

### 4.6 Budget Request from an HOD (Level 1 verification)
1. HOD submits: status PENDING_PRINCIPAL_VERIFICATION.
2. Principal opens `/budget/[id]`: items, prices, priorities.
3. **Verify** (status L1_FROZEN, locked and queued for Finance), **Reject** (PRINCIPAL_REJECTED, final) or **Return** (RETURNED_TO_HOD, HOD edits and resubmits). Remarks mandatory for Reject/Return.
4. History entry is added; HOD is notified. Finance then approves or rejects (`FINANCE_APPROVED` / `FINANCE_REJECTED`), outside the Principal's control.

### 4.7 Emergency Budget (Principal is the requester)
1. Principal creates an emergency budget request (goods **or** non-goods, not both; reason mandatory).
2. Goes to **Management**, then Finance.
3. If returned (RETURNED_TO_PRINCIPAL) the Principal edits and resubmits.
4. Once approved, a Purchase Clearance appears under Purchase Clearance (view only), moves through Purchase Dept, Finance, GRN upload.

### 4.8 Role Assignments (seats)
1. Open Role Assignments, see the seats: Principal, College Admin, VP, Academics, each HOD, IQAC, T&P, R&D, R&D Coordinator, Placement, Exam Cell, Library, Webmaster.
2. Pick a seat, then **Assign** (choose a person), **Vacate**, **Update**, **Remove** or **Reactivate**.
3. Resigned/retired faculty are not offered in pickers and cannot be given a seat.
4. **End:** the person's role and menu change at their next session refresh.

### 4.9 Settings
College Information; Faculty Norms (`PUT /api/college/settings/general`); Student Permissions; Leave Module toggles; Leave Approval Routing (who decides which leave); Vacation Staff; Leave Type Rules. Each Save writes immediately with no approval step.

### 4.10 Circulars
Create (DRAFT), Publish (PUBLISHED), archive (ARCHIVED). Principal/VP can always send; others by Circular Permissions, which the Principal/VP set. There is **no approval step**: there is no PENDING status.

### 4.11 Faculty and Staff
Add Faculty (form or Import), edit sections of a profile, issue/reset credentials, delete a faculty record, supporting staff list. Saving a faculty member as RESIGNED/RETIRED automatically vacates their seats.

### 4.12 Students
Browse roster, open a student. **Promotion** tab promotes year-end batches; **Graduated** tab lists graduates. Roster page itself has no Add/Edit/Delete buttons.

---

## 5. Module cards

Format: Purpose / View / Manage / Actions / Filters / Permission / Start / End / Outcome.

- **Hiring Requests**: Decide vacancies. View: pipeline. Manage: nothing but decisions. Actions: Approve, Reject. Filters: status, department. Permission: Principal and VP only. Start: HOD request. End: terminal status. Outcome: HOD can collect candidates, or stop.
- **Interviews / Negotiate / Decisions / Appointment Letters**: later hiring steps; see 4.2 and 4.3. Outcome: appointment letter SENT, then the candidate accepts.
- **Leave Approvals**: see 4.4. **Leave History**: read-only archive.
- **Budget / Budget Report / Budget History / Purchase Clearance**: see 4.5 to 4.7.
- **Courses & Departments**: create/edit departments, courses, course catalog, years taught, timings. Years Taught edits are refused (409) if data still exists for a removed year. Outcome: academic structure for HODs.
- **Students**: browse, filter, promote, view graduates.
- **Timetable View**: published timetables only.
- **Internal Marks**: view only.
- **Faculty / Staff**: see 4.11.
- **Attendance / Reports**: see section 3.
- **Circulars**: see 4.10.
- **Audit Logs**: latest 100 events. **Role Assignments**: 4.8. **Settings**: 4.9.
- **My Profile / Attendance / Leave**: own HR record. Own leave goes to Management.

---

## 6. Approval and decision matrix

| Action | Where | After the action |
|---|---|---|
| Approve | vacancy, interview plan, candidate, leave, budget cycle | status changes, requester notified, audit entry |
| Reject | same + budget request | terminal; reason shown to requester |
| Return / Modify (send back) | interview plan (MODIFIED), budget cycle/request (RETURNED) | requester edits and resubmits |
| Forward | **none by the Principal.** (HOD forwards Other leave to the Principal; Principal forwards nothing) | n/a |
| Reopen | **none.** Vacancy, candidate decisions are terminal (409) | n/a |
| Publish | circulars (and timetable via API only) | visible to recipients |
| Unpublish | circular ARCHIVED; timetable reset/unpin via API | hidden |
| Assign | role seats | person gets that role |
| Modify | settings, faculty, departments, courses | saved at once |
| Lock / Unlock | **Level 1 Freeze** on a verified budget request (no Unlock) | locked for Finance |
| Final decisions | vacancy, candidate, leave (final stage), budget request L1, budget cycle | cannot be flipped |

---

## 7. Relationships with other roles

Format: starts, receives, sees, acts, **Principal does**, ends.

| With | Flow |
|---|---|
| **HOD** | HOD requests vacancy, Principal approves/rejects, HOD told. HOD submits interview plan, Principal approves/modifies/rejects, HOD sets up. HOD submits budget, Principal verifies/returns/rejects, Finance next. HOD forwards Other leave, Principal decides. |
| **Vice Principal** | Same pages and same authority. VP may decide VP-stage leave; Principal-routed leave is Principal only. VP has extra General Admin Vacancies and Adjustment Requests. Each cannot approve their own leave. |
| **Faculty (Panel Member)** | Applies for leave (HOD, then Principal only for Other), Principal views their profile, attendance, history, edits their record. |
| **College Office** | Enters data (students, documents, offers). Principal makes the decisions. Office completes documents and joining after approval. |
| **Students** | Principal only views and promotes. Students do not interact with the Principal. |
| **Management** | Decides the Principal's **own** leave and emergency budgets. Sees Principal attendance. |
| **Finance / Purchase** | After Principal verifies a budget, Finance decides. Purchase handles clearance. |
| **Super Admin** | Controls which menu items Principal sees and creates the college/users. |
| **Dean** | A `DEAN` role exists in the circular permission list, but **no Principal-to-Dean workflow was found**. |
| **Exam Cell / Academics / IQAC / etc.** | Appointed by Principal via seats. Exam circulars are Exam Cell only. |

---

## 8. End points

- Vacancy: Created, Principal Approves, HOD told, HOD collects candidates → Batch.
- Batch/Interview: Submitted, Principal Approves, HOD logistics, Demo/Panel, Principal Final Review → Candidates decided → COMPLETED.
- Candidate: Decision, Appointment Letter SENT, Candidate accepts, joining.
- Leave: Applied, HOD (and Principal/VP if needed), APPROVED/REJECTED, balance + attendance updated, applicant told.
- Budget: Cycle approved, HOD request, Principal L1 freeze, Finance approve/reject (END).
- Emergency: Principal request, Management, Finance, Purchase, GRN, COMPLETED.
- Circular: DRAFT, PUBLISHED, ARCHIVED.
- Seat: Assign/Vacate, role updated.

---

## 9. One full Principal day, start to end

**Login → Dashboard (3 tiles) → Pending Hiring Requests → Review → Approve/Reject → HOD notified**
→ **Interviews → open batch → Approve/Modify/Reject → HOD notified**
→ **(later) Negotiate → set salary and joining date → Decisions → Approve/Reject candidate → Appointment Letter**
→ **Leave Approvals → open request → Approve/Reject (category if Other) → applicant notified, attendance synced**
→ **Budget → cycle: Approve/Reject/Return; HOD request: Verify/Reject/Return → HOD notified, Finance next**
→ **Browse Students, Timetable, Internal Marks, Attendance Reports (read only)**
→ **Faculty/Staff: add/edit as needed → Circulars: publish → Role Assignments: assign seats → Settings: save**
→ **Audit Logs: check what happened → Logout**

---

## 10. Missing, unclear, or conflicting flows (to resolve)

1. **UI vs API mismatch, Students:** page is read-only by design, but the API lets Principal/VP POST/PATCH/DELETE students, bulk-delete, and promote. Decide which is intended.
2. **UI vs API mismatch, Timetable:** page is "read-only published", but the API lets Principal create/edit slots, **publish**, and **reset** a timetable.
3. **Sections:** Principal can view but not create (`POST` is HOD and Super Admin only); Principal's section edit rights were not verified.
4. **Courses:** create is Principal and Super Admin only (VP excluded), while Departments allow VP. Likely an oversight.
5. **Destructive actions without approval:** Principal can delete a faculty record, a user (Principal/VP only), departments, academic years and sessions. No confirmation trail beyond the audit log.
6. **No Forward, no Reopen** anywhere: vacancy and candidate decisions are terminal (409). A mistaken Approve/Reject cannot be undone from the UI.
7. **Vacancy status is unvalidated:** `PATCH vacancy-requests/[id]` accepts any `status` string; "MODIFIED" exists in notifications, but the HOD's follow-up is unclear.
8. **Hiring-batch PATCH:** College Admin exclusion was confirmed on vacancy, leave, budget and candidate routes; I did not confirm it on the batch PATCH (only a comment at line ~168).
9. **Dashboard** shows only hiring; no leave/budget/attendance counts, though those are the Principal's most frequent decisions.
10. **Circulars:** no approval stage; who may publish is broad (a dozen roles, subject to circular permissions).
11. **Audit logs:** capped at 100 rows, no filter, no export, no paging.
12. **Student Permissions config API** (`student-permissions/config`) had no role guard in my scan; verify it is protected.
13. **Dean** role has no Principal flow defined.
14. **Leave routing is split** (PENDING_PRINCIPAL vs PENDING_VICE_PRINCIPAL); a Principal on leave has no documented delegate for Principal-only requests.
15. **No "Unlock"** for an L1-frozen budget; a mistake needs Finance to return it.
16. **College Admin** sees a menu where decision buttons exist elsewhere but API returns 403; check pages show a clear message rather than a failing call.

## 11. Test checklist (derived)
- Login as Principal lands on `/principal`; a college-admin login hides Leave Approvals/Hiring/Budget/Purchase and gets 403 on decisions.
- Each decision (4.1 to 4.6): happy path, missing remarks (400), already decided (409), wrong role (403), notification sent, audit entry written.
- Leave: Principal-only vs VP-stage routing; Other-leave needs category; Maternity gender and service-year checks; own leave cannot be self-approved.
- Candidate approval needs salary > 0 and future joining date.
- Seats: resigned person refused; singleton seats (Principal, VP, College Admin) cannot be duplicated.
- Read-only students/timetable/internal marks pages show no action buttons.
