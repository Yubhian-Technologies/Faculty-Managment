# Dashboard — HOD (M4 surfaces) (`/hod`)

- **M4 pages (of 86):** students (+[studentId], [studentId]/attendance), sections (shared M3)

## Widgets/data sources
| Page | Widgets | API |
|---|---|---|
| `/hod/students` | Dept roster | `api/college/students` (dept-scope) |
| `/hod/students/[studentId]` | Student dossier | `students/[id]` |
| `/hod/students/[studentId]/attendance` | Attendance drill | M5 student-attendance-history |

## Permissions
- Dept scope; section edits via M3 shared routes.

## Code evidence
- Page inventory.
