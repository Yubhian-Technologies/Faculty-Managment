# Shared files — check before you change these

Five files are imported by so much of the app that a small change in any of
them lands somewhere nobody was looking. This page says what each one is, what
actually breaks, and the single question to answer in review.

**Process:** open a PR and tag the owner. Don't push straight to `main` on
these five. The owner is currently **Nithya** (Academic Sessions, Internal
Exams, Leave).

This is about blast radius, not about permission. Ordinary changes get
approved quickly — the point is that somebody who knows the traps looks first.

| File | Imported by | If it goes wrong |
|---|---|---|
| `src/lib/auth/verifySession.ts` | **276** of 285 API route files | Every authorization decision in the app |
| `src/lib/departments/scope.ts` | **50** (47 of them API routes) | One HOD sees or edits another department's data |
| `firestore.rules` | deployed separately | Client-side access to Firestore |
| `src/components/shared/DataTable.tsx` | **68** | Every list screen |
| `src/components/layout/navConfig.ts` | **27** | What each role can see in the sidebar |

---

## `src/lib/auth/verifySession.ts`

Exports `requireCollegeMember`, `requireRole`, `requireCollegeContext`,
`verifySession`, `isCollegeAdmin`, `isDepartmentOffice` and friends. There is
**no `middleware.ts`** in this repo — every route guards itself, through this
file. It has no test coverage.

**Ask in review:** *does this change what `session.role` can be?*

`requireRole` deliberately **rewrites** the returned role: someone who is both
an HOD and something more senior, working as "HOD — <dept>" in the switcher,
is evaluated as HOD so endpoints return their department rather than the whole
college. Roughly 420 `role === "HOD"` checks depend on that. Changing the
resolution order changes which branch all of them take.

Also watch `requireCollegeContext`: a caller whose session carries **no**
`collegeId` may supply one via `?collegeId=`. That is intentional for the
global roles (Super Admin, Finance, Purchase) — but adding a college-scoped
role to one of its 31 call sites would let that role pick its own tenant.

## `src/lib/departments/scope.ts`

This **is** the department-level authorization boundary. There is no second
layer behind it: Firestore rules don't model departments at all. No tests.

**Ask in review:** *is it collapsing the three scope functions?*

```
editableDepartmentNames  ⊃  facultyManageableDepartmentNames  ⊃  ownDepartmentNames
   own + children + managed        own + children                own + children
```

They look redundant and are not. The comments in the file record real bugs
from treating them as interchangeable — a managed ("core") branch's faculty
roster is never the managing HOD's to edit, even though its sections are.

Second question: *is `activeOnly` right for the new caller?* It defaults to
`true`, which narrows to whichever department is picked in the "Working as"
switcher. Correct for an ambient listing; wrong when the department is already
explicit and the question is "do I have authority here at all".

Known quirk, deliberate: every returned array is `.slice(0, 30)`. An HOD with
more than 30 managed branches silently loses scope. It fails closed, but it
fails silently.

## `firestore.rules`

**Read this before editing: the file in the repo is not what is running.**
The deployed ruleset was last published **2026-08-03**; the repo file is
~150 lines further on. Nothing in CI deploys it — it goes out only when
somebody runs `firebase deploy --only firestore:rules` by hand.

To see what is actually live: Firebase Console → Firestore → Rules, or the
Rules REST API (`releases/cloud.firestore`, then fetch the named ruleset).

**Ask in review:** *does this path already have a `match` block?*

Firestore **OR-combines** every matching rule, so a second block for the same
path doesn't tighten anything — the more permissive one wins. That is exactly
how `allow write: if false` on `leaveBalances` ended up doing nothing for
months.

Worth knowing before you write a rule that depends on a role: the JWT carries
only `{role, collegeId, locationId}`. Role normalisation happens *before* the
claim is written, so **rules cannot tell a College Admin from a Principal, or
a Department Office head from an HOD** — and **seat roles are invisible**: a
faculty member holding the HOD seat has `role: "PANEL_MEMBER"` in their token.
A rule written against seats will silently never match.

There is no emulator config and no `@firebase/rules-unit-testing` dependency,
so rules cannot be unit-tested here. Paste into the Console editor to compile
-check without publishing.

## `src/components/shared/DataTable.tsx`

Presentational only — no fetching, no auth. The good kind of risk: a prop
change breaks 68 files at compile time, loudly.

**Ask in review:** *does this touch `groupBy` or `paginate`?*

They interact badly today: `groups` is computed from the current page, so with
both set you get per-page grouping and a group header counting only that
page's rows.

Also note `Column.key` is typed `string`, not `keyof T`, and the default cell
renders `String(row[col.key] ?? "-")` — a typo'd key renders a dash instead of
failing.

## `src/components/layout/navConfig.ts`

**Ask in review:** *is the new item under the right `section` header?*

`computeItemModule` walks **backwards** to the nearest `section`, so an item
inserted in the wrong place is silently assigned to a different module — which
changes which Super Admin visibility toggle hides it. The file already carries
a comment about this exact bug (Budget items landing under "Staff & HR").

Second question: *was `BOTTOM_NAV_ITEMS` updated too?* It is a separate,
hand-maintained list for mobile and drifts from `NAV_ITEMS` freely.

**Nav visibility is not security.** Removing a link does not remove the
capability — the API guard has to exist separately. Never let a navConfig
change be the only thing gating something.

---

## Known gaps, so nobody rediscovers them

- `requireRoleOrHigher` in `verifySession.ts` has **zero call sites**. Don't
  adopt it without reading its own warning about tenant context.
- None of these five files has a test. `scope.ts` and `verifySession.ts`
  between them decide every authorization outcome in the app.
- `npm run lint` currently fails on `main` (128 errors, 118 of them one React
  Compiler rule), and **CI runs lint before typecheck, build and test** — so
  those three steps never execute. Lint cannot be used as a review gate until
  that is dealt with.
