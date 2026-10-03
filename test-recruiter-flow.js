const API_BASE = "http://localhost:3001";

async function main() {
  console.log("==================================================");
  console.log("RECRUITER ASSESSMENT FLOW — REAL END-TO-END PROOF");
  console.log("==================================================\n");

  // ── Step 1: Login as recruiter ──────────────────────────────────────────
  console.log("--- 1. Login as Recruiter ---");
  const loginRes = await fetch(`${API_BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "recruiter@heisenbug.dev",
      password: "recruiterpassword123",
    }),
  });
  const loginData = await loginRes.json();
  if (!loginRes.ok) throw new Error(`Login failed: ${JSON.stringify(loginData)}`);
  const recruiterToken = loginData.token;
  console.log(`✓ Logged in as ${loginData.user.email} (Role: ${loginData.user.role})`);
  console.log(`  Token: ${recruiterToken.slice(0, 20)}...\n`);

  // Fetch available problems to get their version IDs
  const problemsRes = await fetch(`${API_BASE}/api/problems`, {
    headers: { Authorization: `Bearer ${recruiterToken}` },
  });
  const problemsData = await problemsRes.json();
  const problems = problemsData.data;
  console.log(`Fetched ${problems.length} problems from DB:`);
  for (const p of problems) {
    console.log(`  • ${p.slug} (Version ID: ${p.currentVersion.id})`);
  }
  console.log();

  const versionIds = problems.map((p) => p.currentVersion.id);
  const targetVersionId = versionIds[0];

  // ── Step 2: Create Assessment with single problem ─────────────────────────
  console.log("--- 2. Create Real Assessment ---");
  const createAssRes = await fetch(`${API_BASE}/api/assessments`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${recruiterToken}`,
    },
    body: JSON.stringify({
      title: "Senior Backend Engineer Assessment",
      timeLimitMinutes: 45,
      problemVersionId: targetVersionId,
    }),
  });
  const createAssData = await createAssRes.json();
  if (!createAssRes.ok) throw new Error(`Create assessment failed: ${JSON.stringify(createAssData)}`);
  const assessment = createAssData.data;
  console.log(`✓ Assessment created: ${assessment.id}`);
  console.log(`  Title: "${assessment.title}"`);
  console.log(`  Time limit: ${assessment.timeLimitMinutes} minutes`);
  console.log(`  Problems included: ${assessment.problems.length}`);
  for (const ap of assessment.problems) {
    console.log(`    Order ${ap.orderIndex + 1}: ${ap.version.problem.slug}`);
  }
  console.log();

  // ── Step 3: Invite candidate & copy returned link ────────────────────────
  console.log("--- 3. Invite Candidate ---");
  const candidateEmail = "test-candidate-e2e@example.com";
  const inviteRes = await fetch(`${API_BASE}/api/assessments/${assessment.id}/invitations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${recruiterToken}`,
    },
    body: JSON.stringify({ candidateEmail }),
  });
  const inviteData = await inviteRes.json();
  if (!inviteRes.ok) throw new Error(`Invite failed: ${JSON.stringify(inviteData)}`);
  const { invitation, inviteUrl } = inviteData.data;
  console.log(`✓ Invitation created: ${invitation.id}`);
  console.log(`  Candidate: ${invitation.candidateEmail}`);
  console.log(`  Token: ${invitation.token}`);
  console.log(`  Expires at: ${invitation.expiresAt}`);
  console.log(`  Returned link: ${inviteUrl}\n`);

  // ── Step 4: Public Invitation check & Start (incognito candidate session) ──
  console.log("--- 4. Candidate Starts Assessment (Incognito / No Recruiter Token) ---");
  const publicCheckRes = await fetch(`${API_BASE}/api/invitations/${invitation.token}`);
  const publicCheckData = await publicCheckRes.json();
  console.log("GET /api/invitations/:token response:");
  console.log(JSON.stringify(publicCheckData, null, 2));

  console.log("\nPOST /api/invitations/:token/start response:");
  const startRes = await fetch(`${API_BASE}/api/invitations/${invitation.token}/start`, {
    method: "POST",
  });
  const startData = await startRes.json();
  if (!startRes.ok) throw new Error(`Start failed: ${JSON.stringify(startData)}`);
  const candidateToken = startData.data.token;
  const candidateSession = startData.data.session;
  console.log(JSON.stringify({
    token: `${candidateToken.slice(0, 20)}...`,
    session: {
      id: candidateSession.id,
      mode: candidateSession.mode,
      deadline: candidateSession.deadline,
      problemSlug: candidateSession.version.problem.slug,
    },
  }, null, 2));
  console.log(`✓ Workspace ready for candidate in ${candidateSession.mode} mode!`);
  console.log(`  Deadline set to: ${candidateSession.deadline}\n`);

  // ── Step 5: Candidate Submit solution & Recruiter verifies real status ─────
  console.log("--- 5. Candidate Submits Reference Solution via Grader Pipeline ---");
  const fs = require("fs");
  const path = require("path");
  const refCode = fs.readFileSync(
    path.join(__dirname, "packages/problems/be-idempotency-001/solutions/reference.js"),
    "utf8"
  );

  // Save code event first
  await fetch(`${API_BASE}/api/sessions/${candidateSession.id}/events`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${candidateToken}`,
    },
    body: JSON.stringify({
      occurredAt: new Date().toISOString(),
      type: "CODE_SAVE",
      payloadJson: { code: refCode },
    }),
  });

  console.log(`Submitting session ${candidateSession.id} to Docker grader...`);
  const submitRes = await fetch(`${API_BASE}/api/sessions/${candidateSession.id}/submit`, {
    method: "POST",
    headers: { Authorization: `Bearer ${candidateToken}` },
  });
  const submitData = await submitRes.json();
  console.log("POST /api/sessions/:id/submit verdict:");
  console.log(JSON.stringify(submitData.data.verdict, null, 2));

  // Now verify as Recruiter that invitation status updated to SUBMITTED
  console.log("\n--- Recruiter Re-fetches Assessment Detail ---");
  const detailRes = await fetch(`${API_BASE}/api/assessments/${assessment.id}`, {
    headers: { Authorization: `Bearer ${recruiterToken}` },
  });
  const detailData = await detailRes.json();
  const invStatus = detailData.data.invitations[0];
  console.log(`Recruiter view for candidate ${invStatus.candidateEmail}:`);
  console.log(`  Session ID: ${invStatus.sessionId}`);
  console.log(`  Derived Status: ${invStatus.status}`);

  if (invStatus.status === "SUBMITTED" && submitData.data.verdict.score === 100) {
    console.log("\n✅ RECRUITER ASSESSMENT FLOW END-TO-END VERIFICATION COMPLETE!");
  } else {
    console.error("\n❌ Status or score mismatch!");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
