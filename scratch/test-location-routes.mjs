const routes = [
  '/location-dept-head',
  '/location-dept-head/attendance',
  '/location-dept-head/candidates',
  '/location-dept-head/candidates/new',
  '/location-dept-head/interviews',
  '/location-dept-head/interviews/dummy-id',
  '/location-dept-head/profile',
  '/location-dept-head/profile/edit',
  '/location-dept-head/shifts',
  '/location-dept-head/staff',
  '/location-dept-head/vacancies',
  '/location-dept-head/vacancies/new',
  '/location-staff-admin',
  '/location-staff-admin/attendance',
  '/location-staff-admin/departments',
  '/location-staff-admin/departments/new',
  '/location-staff-admin/staff',
  '/location-staff-admin/staff/new',
];

async function checkAll() {
  const results = [];
  for (const r of routes) {
    try {
      const res = await fetch(`http://localhost:3000${r}`);
      if (res.status === 200) {
        console.log(`[PASS 200] ${r}`);
        results.push({ route: r, status: 200 });
      } else {
        const text = await res.text();
        const errMatch = text.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i) || text.match(/"message":"([^"]+)"/);
        const errMsg = errMatch ? errMatch[1] : `HTTP ${res.status}`;
        console.error(`[FAIL ${res.status}] ${r}: ${errMsg.slice(0, 300)}`);
        results.push({ route: r, status: res.status, error: errMsg.slice(0, 300) });
      }
    } catch (err) {
      console.error(`[ERROR] ${r}: ${err.message}`);
      results.push({ route: r, status: 'ERROR', error: err.message });
    }
  }
  return results;
}

checkAll().then((r) => {
  const failed = r.filter((x) => x.status !== 200);
  console.log(`\n--- Summary: ${r.length - failed.length}/${r.length} passed ---`);
  if (failed.length > 0) {
    console.log('Failed routes:');
    failed.forEach((f) => console.log(` - ${f.route} (${f.status}): ${f.error || ''}`));
    process.exit(1);
  }
});
