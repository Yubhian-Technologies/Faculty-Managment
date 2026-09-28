# M5 — Data Model (as-is)

## Entities

| Entity | Path | Key fields | Evidence |
|---|---|---|---|
| AttendanceRecord | `colleges/{id}/attendanceRecords/{id}` | facultyId/uid, date (istDateKey), checkIn/checkOut, source, late?, status | report/manual routes; lateStatus |
| LateAttendanceCounter | `colleges/{id}/lateAttendanceCounters/{uid?}` | count, month key | lateAttendancePenalty.ts:8 |
| CheckInPermission | `colleges/{id}/attendanceCheckInPermissions/{id}` | granter→grantee cascade | checkInPermission.ts:8 |
| WorkingDays | `colleges/{id}/workingDays/{roleId?}` | per-role Sunday override | workingDays.ts:18 |
| Holiday | `colleges/{id}/holidays/{id}` + `summerHolidays` | date ranges | leave/holidaysCount.ts:26-94 |
| StudentAttendanceSession | `colleges/{id}/{dept}/studentAttendance/{id}` (COLLECTION_GROUP) | id `assign_date_period`; entries[]; status IN_PROGRESS/SUBMITTED; expectedUpdatedAt | types/studentAttendance.ts; periodAttendanceStatus.ts:9 |
| NotPostedSettings | `colleges/{id}/settings/{doc}` | enabled, cutoff, lastRunDate | notPostedSettings.ts:24 |
| Location staff attendance / shifts | location-scoped collections | shiftId, rotate history | lib/location/* `[UNVERIFIED names]` |

## Mermaid ER

```mermaid
erDiagram
    FACULTY ||--o{ ATTENDANCE_RECORD : "per day"
    FACULTY ||--o| LATE_COUNTER : "per month"
    USER ||--o| CHECKIN_PERMISSION : "granted by"
    ROLE ||--o| WORKING_DAYS : "sunday override"
    TIMETABLE_SLOT ||--o{ STUDENT_ATTENDANCE : "assign_date_period"
    STUDENT ||--o{ STUDENT_ATTENDANCE : "entries"
    SETTINGS ||--|| NOT_POSTED_SETTINGS : "college"
    SHIFT ||--o{ LOCATION_STAFF_ATTENDANCE : "shift-wise"
    STUDENT_ATTENDANCE {
        string id PK
        string assignmentId FK
        string date
        number period
        string status
        number expectedUpdatedAt
    }
    ATTENDANCE_RECORD {
        string id PK
        string uid FK
        string date
        string checkIn
        string checkOut
    }
```

## Indexes (M5)
- studentAttendance COLLECTION_GROUP: [status,sectionId,date], [status,facultyId,date], [status,subjectId,date], [status,department,date].
- attendanceRecords: [facultyId,date↓], [department,date↓].
- notifications: [toUid,createdAt↓], [toUid,read,createdAt↓].
