# M5 — DFD Level 2: M5-SM3 Student Period Attendance Marking

```mermaid
flowchart TD
    FAC["[External Entity] Faculty / Substitute"]
    HOD["[External Entity] HOD (office correction)"]

    P31("(3.1 Resolve Today Periods<br/>IST windows + substitutes + labBatch)")
    P32("(3.2 Submit Roster)")
    P33("(3.3 Edit Session (versioned))")
    P34("(3.4 Office Correction)")
    P35("(3.5 Compute Status (IN_PROGRESS/SUBMITTED))")

    TT[("timetableSlots · courseYearTimings")]
    STU[("students roster")]
    SA[("studentAttendance id=assign_date_period")]
    LVE[("leaveRequests/staffAdjustments (substitutes)")]

    FAC-->P31
    TT-->P31; LVE-->P31; STU-->P31
    P31-->P32-->SA
    P32-->P35
    FAC-->P33-->SA
    HOD-->P34-->SA
    P33-->P35
```

*Evidence: currentPeriod.ts:63-273 (windows, substitute resolution :106, split-lab), types/studentAttendance.ts (id), periodAttendanceStatus.ts:9, office-correction routes.*
