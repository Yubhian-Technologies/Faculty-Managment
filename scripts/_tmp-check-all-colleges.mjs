import { config } from "dotenv";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const { parsed: env } = config({ path: "./.env" });
const privateKey = (env.FIREBASE_ADMIN_PRIVATE_KEY ?? "").replace(/^["']|["']$/g, "").replace(/\\n/g, "\n");

if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: env.FIREBASE_ADMIN_PROJECT_ID,
      clientEmail: env.FIREBASE_ADMIN_CLIENT_EMAIL,
      privateKey,
    }),
  });
}

const db = getFirestore();

async function run() {
  const collegesSnap = await db.collection("colleges").get();
  console.log(`Total colleges: ${collegesSnap.size}`);
  for (const collegeDoc of collegesSnap.docs) {
    const collegeId = collegeDoc.id;
    const collegeName = (collegeDoc.data() ?? {}).name ?? collegeId;
    const usersSnap = await db.collection("colleges").doc(collegeId).collection("users").get();
    const roleCounts = {};
    for (const d of usersSnap.docs) {
      const r = d.data().role ?? "(none)";
      roleCounts[r] = (roleCounts[r] ?? 0) + 1;
    }
    console.log(`\n=== ${collegeName} (${collegeId}) — ${usersSnap.size} users ===`);
    console.log(roleCounts);
    const hodDocs = usersSnap.docs.filter((d) => d.data().role === "HOD");
    console.log(`HOD role docs: ${hodDocs.length}`);
    for (const d of hodDocs) {
      console.log(`  uid=${d.id} name="${d.data().name}"`);
    }
  }
}

run().catch((err) => { console.error(err); process.exit(1); });
