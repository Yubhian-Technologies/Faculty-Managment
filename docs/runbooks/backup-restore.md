# Backups and restore runbook (Firestore + Storage)

Nothing in the repo configures backups. These are console/CLI steps for the project owner. Replace `PROJECT_ID` and `BUCKET`. Command flags change between gcloud releases, so confirm each with `gcloud firestore ... --help` before running.

## 1. Point-in-time recovery (PITR), 7 days of per-minute history
```bash
gcloud firestore databases update --database='(default)' --enable-pitr --project=PROJECT_ID
gcloud firestore databases describe --database='(default)' --project=PROJECT_ID   # pitrEnablement: POINT_IN_TIME_RECOVERY_ENABLED
```
Cost: extra storage for the retained window.

## 2. Scheduled daily backups (kept 14 days)
```bash
gcloud firestore backups schedules create --database='(default)' --recurrence=daily --retention=14d --project=PROJECT_ID
gcloud firestore backups schedules list --database='(default)' --project=PROJECT_ID
```
Optionally a weekly schedule with a longer retention (`--recurrence=weekly --day-of-week=SUN --retention=12w`).

## 3. Off-platform export (optional, for long retention)
```bash
gcloud firestore export gs://BUCKET/firestore-exports/$(date +%F) --project=PROJECT_ID
```
Use a bucket in a different region/project, with its own access controls. Schedule it with Cloud Scheduler calling a small Cloud Function, or run it from a trusted machine. A function under `functions/` was not added; add one only if you want it in this repo.

## 4. Storage (uploaded documents, photos)
```bash
gsutil versioning set on gs://BUCKET
gsutil lifecycle set lifecycle.json gs://BUCKET   # e.g. delete noncurrent versions older than 30 days
```

## 5. Restore
Never restore over the live database. Restore into a NEW database, check it, then copy the needed data back or repoint the app.
- From a scheduled backup:
  `gcloud firestore databases restore --source-backup=projects/PROJECT_ID/locations/LOCATION/backups/BACKUP_ID --destination-database=restore-YYYYMMDD --project=PROJECT_ID`
- From PITR (any minute within 7 days): clone the database at a timestamp:
  `gcloud firestore databases clone --source-database=projects/PROJECT_ID/databases/'(default)' --destination-database=restore-YYYYMMDD --snapshot-time=2026-10-04T06:00:00Z --project=PROJECT_ID`
- From an export: `gcloud firestore import gs://BUCKET/firestore-exports/DATE --project=PROJECT_ID` (imports into the target database; use a scratch project for checks).
- Verify: count a few collections (`colleges`, `colleges/{id}/students`, `attendanceRecords`) against production, open a sample student and faculty record.
- Cut over: either export from the restored database and import the affected collections, or point `FIREBASE_ADMIN_*` at the restored database (named databases need the app to select it).

## 6. Drill
Do a restore into a scratch database once per quarter and record the time it took. A backup that has never been restored is not yet a backup.

## 7. Related one-off scripts
`scripts/*.mjs` that change data are dry-run by default and write a JSON backup under `backups/` before `--apply`. Those backups are for undoing that script only, not disaster recovery.
