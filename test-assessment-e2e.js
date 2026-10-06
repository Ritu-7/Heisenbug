// test-assessment-e2e.js
const API_BASE = 'http://localhost:3001/api';

async function request(url, options = {}) {
  const res = await fetch(url, options);
  const json = await res.json();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${JSON.stringify(json)}`);
  }
  return json;
}

async function runProof() {
  console.log('=== ASSESSMENT MODE & WORKSPACE E2E PROOF ===\n');

  // 1. Recruiter Login
  console.log('1. Logging in as recruiter (recruiter@heisenbug.dev)...');
  const recruiterLogin = await request(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'recruiter@heisenbug.dev', password: 'recruiterpassword123' }),
  });
  const recruiterToken = recruiterLogin.token;
  console.log('  ✓ Recruiter login successful.');

  const recruiterHeaders = {
    'Authorization': `Bearer ${recruiterToken}`,
    'Content-Type': 'application/json',
  };

  // 2. Fetch problems to get problemVersionId
  console.log('\n2. Fetching problem catalogue...');
  const problemsRes = await request(`${API_BASE}/problems`, { headers: recruiterHeaders });
  const problems = problemsRes.data;
  console.log(`  ✓ Found ${problems.length} problems: ${problems.map(p => p.slug).join(', ')}`);

  const firstProblem = problems[0];
  const versionId = firstProblem.currentVersion.id;

  // 3. Create Assessment
  console.log(`\n3. Creating assessment for '${firstProblem.slug}' (Version ${versionId})...`);
  const assessmentRes = await request(`${API_BASE}/assessments`, {
    method: 'POST',
    headers: recruiterHeaders,
    body: JSON.stringify({
      title: 'Senior Frontend Engineer Technical Assessment',
      timeLimitMinutes: 45,
      problemVersionId: versionId,
    }),
  });
  const assessment = assessmentRes.data;
  console.log(`  ✓ Assessment created. ID: ${assessment.id}, Title: "${assessment.title}", Time Limit: ${assessment.timeLimitMinutes} min`);

  // 4. Create Invitation
  console.log('\n4. Generating candidate invitation...');
  const candidateEmail = 'candidate-test@example.com';
  const inviteRes = await request(`${API_BASE}/assessments/${assessment.id}/invitations`, {
    method: 'POST',
    headers: recruiterHeaders,
    body: JSON.stringify({ candidateEmail }),
  });
  const { invitation, inviteUrl } = inviteRes.data;
  console.log(`  ✓ Invitation created for ${candidateEmail}`);
  console.log(`    Token: ${invitation.token}`);
  console.log(`    Invite URL: ${inviteUrl}`);

  // 5. Public Candidate fetches invitation info
  console.log('\n5. Candidate views invitation page GET /api/invitations/:token...');
  const publicInviteRes = await request(`${API_BASE}/invitations/${invitation.token}`);
  console.log('  ✓ Public invitation retrieved:');
  console.log(`    Assessment Title: ${publicInviteRes.data.assessment.title}`);
  console.log(`    Time Limit: ${publicInviteRes.data.assessment.timeLimitMinutes} mins`);
  console.log(`    Expires At: ${publicInviteRes.data.expiresAt}`);

  // 6. Candidate clicks "Start Assessment"
  console.log('\n6. Candidate clicks "Start Assessment" POST /api/invitations/:token/start...');
  const startRes = await request(`${API_BASE}/invitations/${invitation.token}/start`, {
    method: 'POST',
  });
  const candidateToken = startRes.data.token;
  const assessmentSession = startRes.data.session;

  console.log('  ✓ Assessment started:');
  console.log(`    Session ID: ${assessmentSession.id}`);
  console.log(`    Mode: ${assessmentSession.mode}`);
  console.log(`    Deadline: ${assessmentSession.deadline}`);
  console.log(`    Redirect path constructed by Invite page: /problems/${firstProblem.slug}?sessionId=${assessmentSession.id}`);

  // Verify requirements for Assessment Mode
  if (assessmentSession.mode !== 'ASSESSMENT') {
    throw new Error(`Expected mode ASSESSMENT but got ${assessmentSession.mode}`);
  }
  if (!assessmentSession.deadline) {
    throw new Error('Expected session deadline to be set for ASSESSMENT mode');
  }

  // 7. Workspace loads session using query param sessionId
  console.log('\n7. Workspace page loads session via GET /api/sessions/:id...');
  const candidateHeaders = {
    'Authorization': `Bearer ${candidateToken}`,
    'Content-Type': 'application/json',
  };

  const loadedSessionRes = await request(`${API_BASE}/sessions/${assessmentSession.id}`, {
    headers: candidateHeaders,
  });
  const loadedSession = loadedSessionRes.data;

  console.log('  ✓ Session loaded on Workspace page:');
  console.log(`    ID: ${loadedSession.id}`);
  console.log(`    Mode: ${loadedSession.mode}`);
  console.log(`    Problem Slug: ${loadedSession.version.problem.slug}`);
  console.log(`    Deadline: ${loadedSession.deadline}`);

  // 8. Confirm practice mode works for all 4 problems
  console.log('\n8. Confirming Practice mode for all 4 problems...');
  for (const prob of problems) {
    const practiceSessionRes = await request(`${API_BASE}/sessions`, {
      method: 'POST',
      headers: candidateHeaders,
      body: JSON.stringify({ versionId: prob.currentVersion.id, mode: 'PRACTICE' }),
    });
    console.log(`  ✓ Practice session created for ${prob.slug}: ID ${practiceSessionRes.data.id} (mode: ${practiceSessionRes.data.mode})`);
  }

  console.log('\n==================================================');
  console.log('✅ ALL ASSESSMENT MODE & PRACTICE MODE TESTS PASSED PERFECTLY!');
  console.log('==================================================');
}

runProof().catch((err) => {
  console.error('\n❌ Proof failed:', err);
  process.exit(1);
});
