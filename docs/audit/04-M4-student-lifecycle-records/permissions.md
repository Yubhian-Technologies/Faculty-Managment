# M4 — Permissions (as-is)

| Action | Principal/VP | HOD | College Office | Panel | Class Leader |
|---|---|---|---|---|---|
| View students | ✅ college | ✅ dept | ✅ college | ✅ | ➖ (own section via timetable only) |
| Add/edit students | ✅ | ✅ dept | ✅ | ➖ | ➖ |
| Import students | ✅ | ➖ | ✅ | ➖ | ➖ |
| Bulk delete | ✅ | ➖ | 🔎? | ➖ | ➖ |
| Distribute cohort | ✅ | ✅ dept | ➖ | ➖ | ➖ |
| Promote | ✅ | ➖ | ➖ | ➖ | ➖ |
| Graduates view | ✅ | ✅ | ✅ | ➖ | ➖ |
| Class-leader timetable | ➖ | ➖ | ➖ | ➖ | ✅ read own section |

Scoping: dept via scope.ts; HOD cannot edit other departments' students. Panel read-only.

Gaps: bulk-delete actor + audit trail unverified; class-leader binding management UI location unverified (likely via M1 user creation with CLASS_LEADER role).
