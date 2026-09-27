import fs from 'fs';
import path from 'path';

const dirs = [
  'src/app/(dashboard)/location-dept-head',
  'src/app/(dashboard)/location-staff-admin',
];

function getAllFiles(dir, all = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      getAllFiles(full, all);
    } else if (e.name.endsWith('.tsx')) {
      all.push(full);
    }
  }
  return all;
}

const files = dirs.flatMap((d) => getAllFiles(d));
console.log(`Scanning ${files.length} tsx files for potential handler or scope issues...`);

const issues = [];
for (const f of files) {
  const code = fs.readFileSync(f, 'utf8');
  // Match simple patterns like onClick={handlerName} where handlerName is a plain identifier
  const handlerMatches = [...code.matchAll(/on[A-Z][a-zA-Z0-9]*=\{([a-zA-Z0-9_]+)\}/g)];
  for (const m of handlerMatches) {
    const fnName = m[1];
    // check if fnName is declared or imported
    const isDeclared =
      new RegExp(`(function\\s+${fnName}|const\\s+${fnName}\\s*=|let\\s+${fnName}\\s*=|import[\\s\\S]*?\\b${fnName}\\b)`).test(code);
    if (!isDeclared) {
      issues.push({ file: f, handler: fnName, match: m[0] });
    }
  }
}

if (issues.length === 0) {
  console.log('All direct event handlers are properly declared and imported!');
} else {
  console.log('Found potential undeclared handler references:');
  issues.forEach((i) => console.log(` - ${i.file}: ${i.match} (${i.handler})`));
}
