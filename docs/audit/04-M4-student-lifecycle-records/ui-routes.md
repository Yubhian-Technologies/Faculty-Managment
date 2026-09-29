# M4 — UI Routes (as-is)

```text
/college-office/students (+import)
/college-office/graduates
/hod/students (+[studentId], [studentId]/attendance)
/hod/sections (+new, [id], [id]/edit)        # shared M3
/principal/students (+[studentId])
/principal/promotions
/principal/graduates
/principal/sections (+[id])                   # shared M3
/panel/students (+/batches)
/class-leader · /class-leader/timetable · /class-leader/profile
```

Guards: proxy role prefixes; student ids validated college-side. Nav: college-office/hod/principal sections entries; class-leader minimal nav.
