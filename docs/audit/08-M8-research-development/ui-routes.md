# M8 — UI Routes (as-is)

```text
/r-and-d                          home
  ├ /publications (+new, [id]/edit, import)
  ├ /citation-metrics
  ├ /research-profiles
  ├ /consultancy-projects · /sponsored-projects · /seed-funding · /research-services
  ├ /phd-supervision · /hackathons · /innovations · /discovery-innovation
  ├ /record/[module]/[id]         generic detail
  ├ /leave (+apply, history/[type])
  └ /profile (+[module], [module]/edit)

/rnd-coordinator                  seat holders (review inbox)
  └ /rnd-coordinator/profile
```

Faculty submit through profile module pages (`/<role>/profile/[module]` and staff editors `/hod/faculty/[id]/[module]` etc.).

Guards: proxy `/r-and-d` (R_AND_D role) and `/rnd-coordinator` (RND_COORDINATOR seat; note: seat holders' primary role is faculty — proxy path grant is role-based, so seat resolution matters `[UNVERIFIED how proxy grants /rnd-coordinator to a faculty login]` `[GAP]`).
