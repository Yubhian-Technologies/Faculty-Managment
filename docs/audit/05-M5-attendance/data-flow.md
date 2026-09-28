# M5 — Data Flow (as-is)

## M5-SM1 Faculty check-in

**Actors:** any staff role. **Trigger:** arriving on campus.
**Preconditions:** within geofence (or permission cascade); not on approved leave; working day (or Sunday override); face registered.
**Main flow:**
1. `POST /api/college/attendance/check-in` — geofence verify (geofence.ts) → holiday/Sunday gates (workingDays.ts, holidaysCount via leave lib) → face verify (faceMatch EAR/yaw) → late detection (lateStatus 09:05 cutoff) → penalty tx if late (`lateAttendancePenalty.ts`, idempotent runTransaction — check-in/route.ts:79) → write `attendanceRecords`.
2. Check-out similar; missed checkouts closed by `closeMissedCheckouts` (admin-triggered `[UNVERIFIED trigger]`).
**Offline:** queue submissions client-side (offlineSubmitQueue) and replay.
**Errors:** OUTSIDE_GEOFENCE / ON_LEAVE / NON_WORKING_DAY / FACE_MISMATCH → 4xx with reason.

```mermaid
sequenceDiagram
    actor F as Faculty
    participant UI as check-in page
    participant API as POST /api/college/attendance/check-in
    participant G as geofence/face/workingDays
    participant FS as attendanceRecords + lateAttendanceCounters
    F->>UI: capture face + location
    UI->>API: POST {coords, faceImage}
    API->>G: verify geofence → holiday/Sunday → leave → face
    alt late (after 09:05 IST)
        API->>FS: runTransaction increment late counter (idempotent)
    end
    API->>FS: upsert attendanceRecords (checkIn)
    API-->>UI: 200 {status, late?}
```

## M5-SM3 Student attendance marking

**Actors:** faculty (assigned slot), substitute, HOD (office correction). **Trigger:** period start.
**Flow:**
1. `GET today-periods` — currentPeriod engine: slots for today with `isOpen` IST windows, substitute-aware (`resolveSubstituteSlotsForDate` :106), labBatch split awareness.
2. `POST /api/college/student-attendance` {assignmentId, date, period, roster} — already-SUBMITTED → early return; transactional read+merge+write (roster merge handles late-added students); blank section → 400.
3. `PATCH [id]` {expectedUpdatedAt} — version conflict → 409; 0-students allowed with notes; status IN_PROGRESS (periodAttendanceStatus.ts:9).
4. `POST office-correction` (HOD) + `PATCH office-correction/[id]`.
**Id:** `assign_date_period` (types/studentAttendance.ts).

```mermaid
sequenceDiagram
    participant T as today-periods GET
    actor FAC as Faculty
    participant POST as POST /api/college/student-attendance
    participant FS as studentAttendance
    FAC->>T: load open periods
    T-->>FAC: periods (open windows, subs, lab batches)
    FAC->>POST: mark roster
    alt already SUBMITTED
        POST-->>FAC: early return existing
    else new
        POST->>FS: tx read+merge roster+write (id assign_date_period)
    end
    FAC->>POST: PATCH [id] {expectedUpdatedAt, edits}
    POST-->>FAC: 200 | 409 version conflict
```

## M5-SM4 Reports
- Section report modes (absentOnly/shortage/threshold/consolidated/dailyPercent) — server aggregates over `studentAttendance` COLLECTION_GROUP queries; CSV export (`exportCsv.ts`); percentage engine (`percentage.ts`); absent reports (`absentReport.ts`).
- Faculty completion: `faculty-attendance-completion` ranges from/to|allTime|year+month.

## M5-SM5 Not-posted sweep

```mermaid
sequenceDiagram
    participant SCH as Cloud Scheduler (15m)
    participant FN as attendanceNotPostedSweep
    participant CRON as POST /api/cron/attendance-not-posted
    participant FS as settings + timetableSlots
    SCH->>FN: tick (Asia/Kolkata)
    FN->>CRON: POST Bearer CRON_SECRET
    CRON->>FS: read settings (per college)
    alt reminder enabled AND cutoff passed AND lastRunDate != today
        CRON->>FS: compute ended-but-unsubmitted periods (same engine as today-periods)
        CRON->>FS: notify faculty (notifications)
        CRON->>FS: stamp lastRunDate
    else
        CRON-->>FN: no-op
    end
```

## M5-SM6 Location staff & shifts
`location/staff-attendance` mark + `/report`; `location/shifts` CRUD + `[id]/assign` + `rotate` (rotation roster) — active branch work; components ShiftWiseAttendanceView/ShiftRotationRosterView/ShiftAssignedStaffView.
