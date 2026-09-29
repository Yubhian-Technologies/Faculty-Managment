# M11 — Data Flow (as-is)

Each thin department is a consumer, not a producer. Data flows:

1. **Self attendance:** role opens `/<role>/attendance` → same check-in/out flow as M5-SM1 (face+geo gates, IST) → `attendanceRecords`.
2. **Attendance admin (Library/T&P):** `/<role>/staff-attendance` + `attendance-import` → M5-SM2 flows (dept-scoped to their department via the report route's role handling `[UNVERIFIED which department scope applies for office roles]`).
3. **Leave:** `/<role>/leave*` → M6-SM1/SM2 flows (apply, balances, history) — approval chain per their identity (staffCategoryRouting).
4. **Profile:** `/<role>/profile/[module]` → reads/writes profile modules (research/training modules render via M8 projection data where assigned).

```mermaid
sequenceDiagram
    actor U as Library/T&P/IQAC/Placement user
    participant UI as /<role>/attendance
    participant API as /api/college/attendance/check-in
    participant FS as attendanceRecords
    U->>UI: open
    UI->>API: check-in (face+geo)
    API->>FS: upsert record
    Note over API,FS: identical to M5-SM1; role only changes nav/home
```

No cron/async flows. Errors mirror M5/M6.
