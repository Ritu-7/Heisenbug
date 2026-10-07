// test-rbac-ownership-proof.js
const API_BASE = "http://localhost:3001/api";

async function request(url, options = {}) {
  const res = await fetch(url, options);
  const status = res.status;
  const json = await res.json().catch(() => ({}));
  return { status, data: json };
}

async function login(email, password) {
  const res = await request(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (res.status !== 200) {
    throw new Error(`Login failed for ${email}: ${JSON.stringify(res.data)}`);
  }
  return res.data.token;
}

async function main() {
  console.log("==================================================");
  console.log("RBAC, ADMIN-GATING & OBJECT-LEVEL OWNERSHIP PROOF");
  console.log("==================================================\n");

  // 1. Authenticate users of all 4 roles
  console.log("1. Authenticating test accounts for all roles...");
  const candidateToken = await login("alice@heisenbug.dev", "testcandidate123");
  const recruiterToken = await login("recruiter@heisenbug.dev", "recruiterpassword123");
  const authorToken = await login("author@heisenbug.dev", "authorpassword123");
  const adminToken = await login("admin@heisenbug.dev", "adminpassword123");

  console.log("  ✓ Candidate token acquired (alice@heisenbug.dev, role: CANDIDATE)");
  console.log("  ✓ Recruiter token acquired (recruiter@heisenbug.dev, role: RECRUITER)");
  console.log("  ✓ Author token acquired (author@heisenbug.dev, role: AUTHOR)");
  console.log("  ✓ Admin token acquired (admin@heisenbug.dev, role: ADMIN)\n");

  // 2. Proof: AUTHOR and CANDIDATE hitting RECRUITER-only routes get HTTP 403
  console.log("2. Proving AUTHOR & CANDIDATE are forbidden from RECRUITER-only routes...");

  // Endpoint: POST /api/assessments (requires RECRUITER or ADMIN)
  const candidateHitRecruiter = await request(`${API_BASE}/assessments`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${candidateToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ title: "Hack", timeLimitMinutes: 30, problemVersionId: "foo" }),
  });
  console.log(`  [CANDIDATE -> POST /api/assessments] Status: ${candidateHitRecruiter.status} | Response:`, JSON.stringify(candidateHitRecruiter.data));
  if (candidateHitRecruiter.status !== 403) throw new Error("Expected 403 for Candidate on recruiter route");

  const authorHitRecruiter = await request(`${API_BASE}/assessments`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${authorToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ title: "Hack", timeLimitMinutes: 30, problemVersionId: "foo" }),
  });
  console.log(`  [AUTHOR -> POST /api/assessments]    Status: ${authorHitRecruiter.status} | Response:`, JSON.stringify(authorHitRecruiter.data));
  if (authorHitRecruiter.status !== 403) throw new Error("Expected 403 for Author on recruiter route");

  // 3. Proof: ADMIN-only route GET /api/admin/users
  console.log("\n3. Proving ADMIN-only route gates strictly against RECRUITER, AUTHOR & CANDIDATE...");

  const candHitAdmin = await request(`${API_BASE}/admin/users`, {
    headers: { Authorization: `Bearer ${candidateToken}` },
  });
  console.log(`  [CANDIDATE -> GET /api/admin/users] Status: ${candHitAdmin.status} | Response:`, JSON.stringify(candHitAdmin.data));
  if (candHitAdmin.status !== 403) throw new Error("Expected 403 for Candidate on admin route");

  const authorHitAdmin = await request(`${API_BASE}/admin/users`, {
    headers: { Authorization: `Bearer ${authorToken}` },
  });
  console.log(`  [AUTHOR -> GET /api/admin/users]    Status: ${authorHitAdmin.status} | Response:`, JSON.stringify(authorHitAdmin.data));
  if (authorHitAdmin.status !== 403) throw new Error("Expected 403 for Author on admin route");

  const recruiterHitAdmin = await request(`${API_BASE}/admin/users`, {
    headers: { Authorization: `Bearer ${recruiterToken}` },
  });
  console.log(`  [RECRUITER -> GET /api/admin/users]  Status: ${recruiterHitAdmin.status} | Response:`, JSON.stringify(recruiterHitAdmin.data));
  if (recruiterHitAdmin.status !== 403) throw new Error("Expected 403 for Recruiter on admin route");

  const adminHitAdmin = await request(`${API_BASE}/admin/users`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  console.log(`  [ADMIN -> GET /api/admin/users]      Status: ${adminHitAdmin.status} | User count: ${adminHitAdmin.data.data?.length}`);
  if (adminHitAdmin.status !== 200 || !Array.isArray(adminHitAdmin.data.data)) {
    throw new Error("Expected 200 with user list for Admin on admin route");
  }

  // 4. Proof: Object-level ownership on Sessions
  console.log("\n4. Proving object-level session ownership & cross-tenant protection...");

  // Candidate (Alice) creates a session
  const problemsRes = await request(`${API_BASE}/problems`);
  const firstProblem = problemsRes.data.data[0];
  const versionId = firstProblem.currentVersion.id;

  const aliceSessionRes = await request(`${API_BASE}/sessions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${candidateToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ versionId, mode: "PRACTICE" }),
  });
  const aliceSessionId = aliceSessionRes.data.data.id;
  console.log(`  ✓ Created Alice's practice session: ${aliceSessionId}`);

  // Alice fetches her own session (should succeed with 200)
  const aliceFetchOwn = await request(`${API_BASE}/sessions/${aliceSessionId}`, {
    headers: { Authorization: `Bearer ${candidateToken}` },
  });
  console.log(`  [ALICE -> GET /api/sessions/${aliceSessionId}] Status: ${aliceFetchOwn.status} (Owner permitted)`);
  if (aliceFetchOwn.status !== 200) throw new Error("Expected 200 for owner fetching session");

  // Another user (Author Arthur) tries to fetch Alice's session (must get 403 Forbidden)
  const authorFetchAlice = await request(`${API_BASE}/sessions/${aliceSessionId}`, {
    headers: { Authorization: `Bearer ${authorToken}` },
  });
  console.log(`  [AUTHOR -> GET /api/sessions/${aliceSessionId}] Status: ${authorFetchAlice.status} | Response:`, JSON.stringify(authorFetchAlice.data));
  if (authorFetchAlice.status !== 403) throw new Error("Expected 403 for Author fetching Alice's session");

  // An unrelated recruiter tries to fetch Alice's practice session (must get 403 Forbidden)
  const recruiterFetchAlice = await request(`${API_BASE}/sessions/${aliceSessionId}`, {
    headers: { Authorization: `Bearer ${recruiterToken}` },
  });
  console.log(`  [RECRUITER -> GET /api/sessions/${aliceSessionId}] Status: ${recruiterFetchAlice.status} | Response:`, JSON.stringify(recruiterFetchAlice.data));
  if (recruiterFetchAlice.status !== 403) throw new Error("Expected 403 for Recruiter fetching unrelated practice session");

  // Author tries to fetch Alice's submissions (must get 403 Forbidden)
  const authorFetchSubmissions = await request(`${API_BASE}/sessions/${aliceSessionId}/submissions`, {
    headers: { Authorization: `Bearer ${authorToken}` },
  });
  console.log(`  [AUTHOR -> GET /api/sessions/${aliceSessionId}/submissions] Status: ${authorFetchSubmissions.status} | Response:`, JSON.stringify(authorFetchSubmissions.data));
  if (authorFetchSubmissions.status !== 403) throw new Error("Expected 403 for Author fetching Alice's submissions");

  // Admin fetches Alice's session (should succeed with 200 due to ADMIN override)
  const adminFetchAlice = await request(`${API_BASE}/sessions/${aliceSessionId}`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  console.log(`  [ADMIN -> GET /api/sessions/${aliceSessionId}] Status: ${adminFetchAlice.status} (Admin override permitted)`);
  if (adminFetchAlice.status !== 200) throw new Error("Expected 200 for Admin fetching session");

  // 5. Proof: Assigned recruiter relationship for assessment session
  console.log("\n5. Proving assigned recruiter can view candidate assessment session...");
  const assessmentRes = await request(`${API_BASE}/assessments`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${recruiterToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      title: "RBAC Test Assessment",
      timeLimitMinutes: 60,
      problemVersionId: versionId,
    }),
  });
  const assessmentId = assessmentRes.data.data.id;

  const inviteRes = await request(`${API_BASE}/assessments/${assessmentId}/invitations`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${recruiterToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ candidateEmail: "candidate-rbac@example.com" }),
  });
  const inviteToken = inviteRes.data.data.invitation.token;

  // Candidate starts assessment
  const startRes = await request(`${API_BASE}/invitations/${inviteToken}/start`, { method: "POST" });
  const assessmentSessionId = startRes.data.data.session.id;
  const assessmentCandidateToken = startRes.data.data.token;

  // Candidate accesses their own assessment session -> 200
  const candOwnAssessment = await request(`${API_BASE}/sessions/${assessmentSessionId}`, {
    headers: { Authorization: `Bearer ${assessmentCandidateToken}` },
  });
  console.log(`  [CANDIDATE -> GET assessment session] Status: ${candOwnAssessment.status} (Candidate permitted)`);
  if (candOwnAssessment.status !== 200) throw new Error("Expected 200 for candidate on assessment session");

  // The recruiter who owns the assessment accesses candidate's session -> 200
  const assignedRecruiterFetch = await request(`${API_BASE}/sessions/${assessmentSessionId}`, {
    headers: { Authorization: `Bearer ${recruiterToken}` },
  });
  console.log(`  [ASSIGNED RECRUITER -> GET assessment session] Status: ${assignedRecruiterFetch.status} (Assigned Recruiter permitted)`);
  if (assignedRecruiterFetch.status !== 200) throw new Error("Expected 200 for assigned recruiter");

  // Another user (Author Arthur) tries to access candidate's assessment session -> 403
  const authorFetchAssessment = await request(`${API_BASE}/sessions/${assessmentSessionId}`, {
    headers: { Authorization: `Bearer ${authorToken}` },
  });
  console.log(`  [AUTHOR -> GET assessment session] Status: ${authorFetchAssessment.status} | Response:`, JSON.stringify(authorFetchAssessment.data));
  if (authorFetchAssessment.status !== 403) throw new Error("Expected 403 for unauthorized user on assessment session");

  // 6. Regression check: Practice sessions for all four problems
  console.log("\n6. Confirming Practice mode for all four problems...");
  for (const prob of problemsRes.data.data) {
    const sRes = await request(`${API_BASE}/sessions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${candidateToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ versionId: prob.currentVersion.id, mode: "PRACTICE" }),
    });
    console.log(`  ✓ Practice session for ${prob.slug}: Status ${sRes.status} (ID: ${sRes.data.data.id})`);
    if (sRes.status !== 201) throw new Error(`Failed to create session for ${prob.slug}`);
  }

  console.log("\n==================================================");
  console.log("✅ ALL RBAC & OBJECT-LEVEL OWNERSHIP CHECKS PASSED!");
  console.log("==================================================");
}

main().catch((err) => {
  console.error("\n❌ Test failed:", err);
  process.exit(1);
});
