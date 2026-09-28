# M3 — Events, Jobs & Integrations (as-is)

## Domain events
- Assignment request created/allocated/declined → notify target faculty/HOD (notify referencedBy faculty-assignment-requests).
- Mid-paper assigned → notify setter `[UNVERIFIED]`.
- Publish → optional notification to faculty `[UNVERIFIED]`.

## Jobs
- None scheduled. Timetable generation is synchronous within the draft request.

## Integrations
- Excel import: subjects, departments (`api/college/subjects/import`, `departments/import`).
- Downstream consumers (reads): M5 attendance (timetableSlots + courseYearTimings), class-leader timetable, exam module marks.

## External
- None.
