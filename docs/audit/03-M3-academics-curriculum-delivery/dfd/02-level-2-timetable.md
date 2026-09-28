# M3 — DFD Level 2: M3-SM6 Timetable Draft & Publish

```mermaid
flowchart TD
    TI["[External Entity] Timetable incharge / HOD"]
    LEAVE["[External Entity] M6 approved leave"]

    P61("(6.1 Load Context<br/>section, timings, rules, assignments)")
    P62("(6.2 Stage Slots (manual or generate))")
    P63("(6.3 Validate Rules (hard caps + soft prefs))")
    P64("(6.4 Save Draft)")
    P65("(6.5 Publish (stamp semester + academicYear))")
    P66("(6.6 Overlay Substitutions (read-time))")

    DR[("timetableDrafts/{sectionId}")]
    SL[("timetableSlots")]
    RU[("settings/timetableRules")]
    CY[("courseYearTimings")]
    TA[("teachingAssignments")]
    PS[("PeriodSubstitution (from leave)")]

    TI-->P61
    RU-->P61; CY-->P61; TA-->P61
    P61-->P62-->P63
    P63-->|"diagnostics on violation"|TI
    P63-->P64-->DR
    TI-->P65
    P65-->SL
    LEAVE-->PS
    PS-->P66
    P66-->|"substituteFacultyId/Name/Date (transient)"|TI
```

*Evidence: loadContext.ts:49-85; rules teaching.ts:344-383 (4 hard, 2 soft, DEFAULT_TIMETABLE_RULES); draft doc path teaching.ts:378-380; history-preserving publish semantics teaching.ts:289-309; overlay via periodCoverage (teaching.ts:310-330).*
