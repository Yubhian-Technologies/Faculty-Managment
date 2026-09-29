# Flow — M11-F1: Thin-Department Self Attendance (alias of M5-F1)

- **Flow ID:** M11-F1 (reuses M5-F1 end-to-end)
- **Actors:** LIBRARY / T_AND_P / IQAC_COORDINATOR / PLACEMENT_DEPT
- **Trigger:** `/<role>/attendance`
- **Main success scenario:** identical to `05-M5-attendance/flows/faculty-check-in.md` (check-in/out, gates, late penalty).
- **Differences:** only nav entry + home dashboard; role appears in report route's dept scope via their department membership `[UNVERIFIED exact dept attribution for office roles]`.
- **Code evidence:** page inventory; proxy ROLE_PATH_MAP entries; shared APIs.
