# M5 — Permissions (as-is)

| Action | Faculty/Staff self | HOD | Principal/VP | College Office/ExamCell/Lib/T&P | Panel | Management | Location roles |
|---|---|---|---|---|---|---|---|
| Check-in/out (self) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | (location twin) |
| Register face / reset (own) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| Reset someone's face | ➖ | ✅ (tier down) | ✅ (tier down) | ➖ | ➖ | ✅ (Principal) | — |
| Mark student attendance | ✅ (own slots) | ➖ (corrections only) | ➖ | ➖ | ✅ (per module map) | ➖ | — |
| Office correction | ➖ | ✅ | ➖ | ➖ | ➖ | ➖ | — |
| Staff attendance report | ➖ | ✅ dept tree | ✅ college | ✅ (own scope twins) | ➖ | ✅ all colleges | ✅ location |
| Manual entry / import | ➖ | ➖ (manual cascade 1-tier) | ➖ | ✅ | ➖ | ➖ | ✅ |
| Monthly export | ➖ | ✅ | ✅ | ✅ | ➖ | ✅ | ✅ |
| Not-posted settings | ➖ | ➖ | ✅ | ➖ | ➖ | ➖ | — |
| Completion report | ➖ | ✅ | ✅ | ➖ | ➖ | ✅ | — |
| Shifts CRUD/rotate | ➖ | ➖ | ➖ | ➖ | ➖ | ➖ | ✅ LSA/LDH |

## Scoping
- HOD: dept-tree for reports (report route branches on role); Principal college-wide; Management global reads (requireManagement); Panel marking limited to assigned batches `[UNVERIFIED route guard]`.

## Backend vs frontend
- Verified guards across attendance routes (referencedBy lists); Panel marking backend check unverified `[GAP]`.

## Gaps
1. Student-attendance import absent while staff import exists (map mismatch).
2. Panel marking scope enforcement unverified.
3. Manual-entry 25th payroll lock — mechanism documented, enforcement location not read `[UNVERIFIED]`.
