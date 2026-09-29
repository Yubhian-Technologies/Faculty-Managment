# M11 — UI Routes (as-is)

```text
/library (11)          /t-and-p (11)
  ├ /attendance           (self check-in)
  ├ /attendance-import    (admin)
  ├ /staff-attendance (+[uid])  (admin)
  ├ /leave (+apply, history/[type])
  └ /profile (+[module], [module]/edit)

/iqac-coordinator (7)  /placement-dept (7)
  ├ /attendance
  ├ /leave (+apply, history/[type])
  └ /profile (+[module], [module]/edit)
```

Guards: proxy per-role prefixes + `/leave` shared path; nav minimal (no domain sections).
