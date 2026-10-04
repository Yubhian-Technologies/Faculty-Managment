// Shared plumbing for the one-off maintenance scripts in this folder.
// Rules every script built on it follows:
//   - DRY RUN by default: prints what it WOULD do and writes nothing; --apply writes;
//   - before any write it saves a JSON backup of every document it is about to touch
//     (backups/<name>-<timestamp>.json at the repo root, which .gitignore excludes) so a change can be put back;
//   - idempotent: running it again after --apply finds nothing left to do;
//   - always says which Firebase project it is talking to.
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";

export function init() {
  if (!getApps().length) {
    initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
        clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, "\n"),
      }),
    });
  }
  console.log(`Firebase project: ${process.env.FIREBASE_ADMIN_PROJECT_ID}`);
  return { db: getFirestore(), auth: getAuth() };
}

export function parseArgs(argv = process.argv.slice(2)) {
  const opt = (name) => argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  return { apply: argv.includes("--apply"), opt, flag: (name) => argv.includes(`--${name}`) };
}

/** Writes `docs` to the repo-root backups/ folder and returns the file path. */
export function writeBackup(name, docs) {
  // The repo-root backups/ folder - the one .gitignore already excludes (backups hold personal data).
  const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "backups");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${name}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(file, JSON.stringify(docs, null, 2));
  return file;
}

export function banner(apply) {
  console.log(apply ? "MODE: APPLY (writing)\n" : "MODE: DRY RUN (no writes) - add --apply to write\n");
}
