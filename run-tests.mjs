#!/usr/bin/env node
/**
 * Comprehensive test runner for all academic modules.
 * 
 * Usage:
 *   node run-tests.mjs              # Run all tests
 *   node run-tests.mjs unit          # Unit tests only
 *   node run-tests.mjs api           # API E2E tests only
 *   node run-tests.mjs ui            # UI Playwright tests only
 *   node run-tests.mjs integration   # Integration tests only
 *   node run-tests.mjs report        # Generate final report
 */
import { execSync } from "child_process";
import fs from "fs";
import path from "path";

const TEST_DIRS = {
  unit: ["src/lib/college/__tests__", "src/app/api/college/subjects/__tests__"],
  api: ["tests/e2e/api"],
  ui: ["tests/e2e/ui"],
};

const results = {};

function runTests(label, patterns) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`Running ${label} tests...`);
  console.log(`${"=".repeat(60)}\n`);

  try {
    // Unit tests via vitest
    if (label === "unit") {
      const files = patterns.flatMap(dir =>
        fs.readdirSync(dir).filter(f => f.endsWith(".test.ts")).map(f => `${dir}/${f}`)
      );
      const cmd = `npx vitest run ${files.join(" ")} 2>&1`;
      const output = execSync(cmd, { encoding: "utf-8", timeout: 60000 });
      console.log(output);
      results.unit = { passed: output.includes("Tests ", 0) ? "✓" : "✗", output };
    }

    // API E2E tests via playwright
    if (label === "api" || label === "integration") {
      const files = patterns[0].split("/").filter(Boolean);
      const testFiles = fs.readdirSync("tests/e2e/api").filter(f => f.endsWith(".spec.ts"));
      const cmd = `npx playwright test tests/e2e/api/ --reporter=line 2>&1`;
      try {
        execSync(cmd, { encoding: "utf-8", timeout: 120000 });
        results.api = { passed: true };
      } catch (e) {
        results.api = { passed: false, error: e.message };
      }
    }

    // UI tests via playwright
    if (label === "ui") {
      const testFiles = fs.readdirSync("tests/e2e/ui").filter(f => f.endsWith(".spec.ts"));
      const cmd = `npx playwright test tests/e2e/ui/ --reporter=line 2>&1`;
      try {
        execSync(cmd, { encoding: "utf-8", timeout: 120000 });
        results.ui = { passed: true };
      } catch (e) {
        results.ui = { passed: false, error: e.message };
      }
    }
  } catch (e) {
    results[label] = { passed: false, error: e.message };
  }

  return results;
}

function generateReport() {
  const reportDir = "test-reports";
  if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir, { recursive: true });

  const report = {
    timestamp: new Date().toISOString(),
    modules: [
      { name: "Subjects", files: ["src/app/api/college/subjects/route.ts", "src/app/(dashboard)/academics/subjects/page.tsx", "src/app/(dashboard)/academics/subjects/new/page.tsx"] },
      { name: "Course Catalog", files: ["src/app/api/college/course-catalog/route.ts", "src/app/(dashboard)/principal/course-catalog"] },
      { name: "Subject Semester Assignments", files: ["src/app/api/college/subject-semester-assignments/route.ts"] },
      { name: "Teaching Assignments", files: ["src/app/api/college/teaching-assignments/route.ts", "src/app/(dashboard)/hod/teaching-assignments"] },
      { name: "Timetable / Timetable Slots", files: ["src/app/api/college/timetable-slots/route.ts", "src/app/api/college/timetable/draft/route.ts", "src/app/api/college/timetable/publish/route.ts"] },
      { name: "Student Attendance", files: ["src/app/api/college/student-attendance/route.ts", "src/app/(dashboard)/academics/student-attendance"] },
      { name: "Sections", files: ["src/app/api/college/sections/route.ts"] },
      { name: "Mid Paper Assignments", files: ["src/app/api/college/mid-paper-assignments/route.ts"] },
      { name: "Exam Configurations", files: ["src/app/api/college/exam-configurations/route.ts"] },
      { name: "Course Year Timings", files: ["src/app/api/college/course-year-timings/route.ts"] },
      { name: "Faculty Leave / Substitute", files: ["src/lib/leave/periodCoverage.ts"] },
    ],
    testResults: results,
    criticalGaps: [
      "timetable-slots GET uses .where('year', '==', section.year) which filters out master subjects (no year)",
      "subject-semester-assignments uses catalogId + year instead of courseId + regulation",
      "Section.year vs Subject.regulation mismatch in semester resolution",
    ],
  };

  fs.writeFileSync(`${reportDir}/academic-modules-report.json`, JSON.stringify(report, null, 2));

  // Generate markdown report
  let md = `# Academic Modules - Test Report\n\n`;
  md += `Generated: ${report.timestamp}\n\n`;
  md += `## Test Results\n\n`;
  for (const [key, val] of Object.entries(results)) {
    md += `- **${key}**: ${val.passed ? "✅ PASSED" : "❌ FAILED"}\n`;
  }
  md += `\n## Modules Tested\n\n`;
  for (const mod of report.modules) {
    md += `- **${mod.name}**: ${mod.files.length} file(s)\n`;
  }
  md += `\n## Critical Gaps Found\n\n`;
  for (const gap of report.criticalGaps) {
    md += `- ⚠️ ${gap}\n`;
  }
  md += `\n## Summary\n\n`;
  const totalPassed = Object.values(results).filter(r => r.passed).length;
  const totalFailed = Object.values(results).filter(r => !r.passed).length;
  md += `- **Total Suites**: ${Object.keys(results).length}\n`;
  md += `- **Passed**: ${totalPassed}\n`;
  md += `- **Failed**: ${totalFailed}\n`;

  fs.writeFileSync(`${reportDir}/academic-modules-report.md`, md);
  console.log(`\nReport generated: ${reportDir}/academic-modules-report.md`);
  console.log(md);
}

// CLI
const mode = process.argv[2] || "all";
if (mode === "all") {
  runTests("unit", TEST_DIRS.unit);
  runTests("api", TEST_DIRS.api);
  runTests("ui", TEST_DIRS.ui);
  generateReport();
} else if (TEST_DIRS[mode]) {
  runTests(mode, TEST_DIRS[mode]);
  if (mode !== "unit") generateReport();
} else {
  console.log("Usage: node run-tests.mjs [all|unit|api|ui|integration|report]");
}
