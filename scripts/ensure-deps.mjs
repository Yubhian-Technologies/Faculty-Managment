#!/usr/bin/env node
// Runs before dev/build/start (see package.json "pre*" scripts). If package-lock.json
// has changed since the last install - e.g. after a git pull/checkout/merge - node_modules
// is stale, so this re-runs `npm install` automatically instead of failing later with a
// confusing "Module not found" error.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const lockPath = join(rootDir, "package-lock.json");
const stampPath = join(rootDir, "node_modules", ".deps-hash");

const lockHash = createHash("sha256").update(readFileSync(lockPath)).digest("hex");
const stamp = existsSync(stampPath) ? readFileSync(stampPath, "utf8").trim() : null;

if (stamp === lockHash) {
  process.exit(0);
}

console.log("[ensure-deps] package-lock.json changed since last install - running npm install...");
// --include=dev is required here: npm defaults `omit` to "dev" whenever
// NODE_ENV=production (as it is on Vercel), which would otherwise silently
// strip devDependencies like tailwindcss/@tailwindcss/postcss on this re-install.
const result = spawnSync("npm", ["install", "--include=dev"], {
  stdio: "inherit",
  cwd: rootDir,
  shell: process.platform === "win32",
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

mkdirSync(dirname(stampPath), { recursive: true });
writeFileSync(stampPath, lockHash);
