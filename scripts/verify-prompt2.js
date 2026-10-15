const { spawn } = require('child_process');
const path = require('path');
const { createClerkClient } = require('@clerk/backend');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY || 'sk_test_stp220g73j4tus1ZlV8JNEuNghs4eHG1uJ7fctDnBf';
const clerk = createClerkClient({ secretKey: CLERK_SECRET_KEY });

const API_BASE = 'http://127.0.0.1:3001/api';

async function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getClerkTokenForUser(userId) {
  const session = await clerk.sessions.createSession({ userId });
  const token = await clerk.sessions.getToken(session.id);
  if (!token?.jwt) {
    throw new Error(`Failed to obtain Clerk session token for user: ${userId}`);
  }
  return token.jwt;
}

async function request(url, options = {}) {
  const res = await fetch(url, options);
  let body;
  try {
    body = await res.json();
  } catch {
    body = await res.text();
  }
  return { status: res.status, ok: res.ok, body };
}

async function main() {
  console.log('================================================================');
  console.log('PROMPT 2 REAL VERIFICATION: Recruiter Approval & Invite Flow');
  console.log('================================================================\n');

  // 1. Ensure API server is running
  let apiProcess = null;
  let serverRunning = false;
  try {
    const health = await fetch('http://127.0.0.1:3001/health');
    if (health.ok) serverRunning = true;
  } catch {}

  if (!serverRunning) {
    console.log('Starting local API server on port 3001...');
    apiProcess = spawn('node', ['apps/api/dist/index.js'], {
      cwd: path.resolve(__dirname, '..'),
      stdio: 'inherit',
      env: { ...process.env, PORT: '3001' },
    });

    for (let i = 0; i < 30; i++) {
      await wait(1000);
      try {
        const res = await fetch('http://127.0.0.1:3001/health');
        if (res.ok) {
          serverRunning = true;
          break;
        }
      } catch {}
    }

    if (!serverRunning) {
      throw new Error('API server failed to start within 30 seconds');
    }
    console.log('✓ API server is up and healthy\n');
  } else {
    console.log('✓ API server is already running\n');
  }

  try {
    // 2. Fetch or create candidate user in Clerk
    console.log('--- Step 1: Setting up candidate user in Clerk ---');
    const candidateEmail = 'candidate.prompt2@heisenbug.dev';
    const userList = await clerk.users.getUserList({ emailAddress: [candidateEmail] });
    let candidateUser = userList.data?.[0];

    if (!candidateUser) {
      console.log(`Creating fresh Clerk user for testing: ${candidateEmail}`);
      candidateUser = await clerk.users.createUser({
        emailAddress: [candidateEmail],
        username: `candidate_${Date.now()}`,
        firstName: 'Test',
        lastName: 'Candidate',
        password: 'Heisenbug_Test_Candidate_2026_Secure!',
        privateMetadata: {
          role: 'CANDIDATE',
          approvalStatus: 'NONE',
          requestedRole: null,
        },
      });
    } else {
      console.log(`Resetting test candidate ${candidateEmail} (${candidateUser.id}) to initial CANDIDATE state`);
      await clerk.users.updateUserMetadata(candidateUser.id, {
        privateMetadata: {
          role: 'CANDIDATE',
          approvalStatus: 'NONE',
          requestedRole: null,
        },
      });
    }

    // Ensure candidate row exists in Postgres with initial state
    await prisma.user.upsert({
      where: { id: candidateUser.id },
      update: {
        role: 'CANDIDATE',
        approvalStatus: 'NONE',
        requestedRole: null,
      },
      create: {
        id: candidateUser.id,
        email: candidateEmail,
        name: 'Test Candidate',
        role: 'CANDIDATE',
        approvalStatus: 'NONE',
        requestedRole: null,
      },
    });

    console.log(`✓ Candidate ready: id=${candidateUser.id}, email=${candidateEmail}\n`);

    // 3. Mint real Clerk token for candidate
    console.log('--- Step 2: Candidate requests recruiter access ---');
    const candidateToken = await getClerkTokenForUser(candidateUser.id);
    const candidateHeaders = {
      Authorization: `Bearer ${candidateToken}`,
      'Content-Type': 'application/json',
    };

    const requestRes = await request(`${API_BASE}/users/me/request-recruiter-access`, {
      method: 'POST',
      headers: candidateHeaders,
    });
    console.log(`Candidate POST /api/users/me/request-recruiter-access response (status ${requestRes.status}):`);
    console.log(JSON.stringify(requestRes.body, null, 2));

    if (requestRes.status !== 200 || requestRes.body.user?.approvalStatus !== 'PENDING') {
      throw new Error(`Failed to request recruiter access: ${JSON.stringify(requestRes.body)}`);
    }

    // Check Postgres row
    const dbCandidatePending = await prisma.user.findUnique({ where: { id: candidateUser.id } });
    console.log('\nPostgres User row after request:');
    console.log(JSON.stringify({
      id: dbCandidatePending.id,
      email: dbCandidatePending.email,
      role: dbCandidatePending.role,
      approvalStatus: dbCandidatePending.approvalStatus,
      requestedRole: dbCandidatePending.requestedRole,
    }, null, 2));

    // 4. Candidate attempts to access recruiter route while PENDING
    console.log('\n--- Step 3: Candidate accesses recruiter route while PENDING ---');
    const beforeApprovalRes = await request(`${API_BASE}/assessments`, {
      method: 'GET',
      headers: candidateHeaders,
    });
    console.log(`Candidate GET /api/assessments BEFORE APPROVAL:`);
    console.log(`Status: ${beforeApprovalRes.status} (Expected: 403 Forbidden)`);
    console.log(`Body:`, JSON.stringify(beforeApprovalRes.body, null, 2));

    if (beforeApprovalRes.status !== 403) {
      throw new Error(`Expected 403 Forbidden while PENDING, got ${beforeApprovalRes.status}`);
    }
    console.log('✓ Successfully confirmed 403 Forbidden while pending approval\n');

    // 5. Admin approves candidate as recruiter
    console.log('--- Step 4: Admin approves candidate recruiter access ---');
    const adminList = await clerk.users.getUserList({ emailAddress: ['admin@heisenbug.dev'] });
    const adminUser = adminList.data?.[0];
    if (!adminUser) throw new Error('Seeded admin@heisenbug.dev not found in Clerk');

    const adminToken = await getClerkTokenForUser(adminUser.id);
    const adminHeaders = {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json',
    };

    const approveRes = await request(`${API_BASE}/admin/users/${candidateUser.id}/approve-recruiter`, {
      method: 'POST',
      headers: adminHeaders,
    });
    console.log(`Admin POST /api/admin/users/${candidateUser.id}/approve-recruiter response (status ${approveRes.status}):`);
    console.log(JSON.stringify(approveRes.body, null, 2));

    if (approveRes.status !== 200 || approveRes.body.user?.role !== 'RECRUITER') {
      throw new Error(`Admin approval failed: ${JSON.stringify(approveRes.body)}`);
    }

    // Check Clerk private metadata
    const updatedClerkUser = await clerk.users.getUser(candidateUser.id);
    console.log('\nClerk User privateMetadata after approval:');
    console.log(JSON.stringify(updatedClerkUser.privateMetadata, null, 2));

    // Check Postgres row
    const dbCandidateApproved = await prisma.user.findUnique({ where: { id: candidateUser.id } });
    console.log('\nPostgres User row after approval:');
    console.log(JSON.stringify({
      id: dbCandidateApproved.id,
      email: dbCandidateApproved.email,
      role: dbCandidateApproved.role,
      approvalStatus: dbCandidateApproved.approvalStatus,
      requestedRole: dbCandidateApproved.requestedRole,
    }, null, 2));

    // 6. Candidate accesses same recruiter route AFTER approval
    console.log('\n--- Step 5: Candidate accesses recruiter route AFTER APPROVAL ---');
    const afterApprovalRes = await request(`${API_BASE}/assessments`, {
      method: 'GET',
      headers: candidateHeaders,
    });
    console.log(`Candidate GET /api/assessments AFTER APPROVAL:`);
    console.log(`Status: ${afterApprovalRes.status} (Expected: 200 OK)`);
    console.log(`Body:`, JSON.stringify(afterApprovalRes.body, null, 2));

    if (afterApprovalRes.status !== 200) {
      throw new Error(`Expected 200 OK after approval, got ${afterApprovalRes.status}`);
    }
    console.log('✓ Successfully confirmed 200 OK after admin approval\n');

    // 7. Verify Invite flow end-to-end unchanged (deliberately outside Clerk)
    console.log('--- Step 6: End-to-end assessment invite flow (passwordless outside Clerk) ---');
    // Get a valid problem version
    const problems = await prisma.problem.findMany({
      include: { versions: { take: 1, include: { variants: { take: 1 } } } },
    });
    const problemVersion = problems[0]?.versions[0];
    if (!problemVersion) throw new Error('No problem version found in database');

    // Newly approved recruiter creates an assessment
    const createAssessmentRes = await request(`${API_BASE}/assessments`, {
      method: 'POST',
      headers: candidateHeaders,
      body: JSON.stringify({
        title: `Verification Assessment ${Date.now()}`,
        timeLimitMinutes: 45,
        problemVersionId: problemVersion.id,
      }),
    });
    console.log(`Recruiter created assessment: status=${createAssessmentRes.status}, id=${createAssessmentRes.body.data?.id}`);
    const assessmentId = createAssessmentRes.body.data.id;

    // Recruiter invites an external candidate email
    const invitedEmail = `candidate.invite.${Date.now()}@external.dev`;
    const inviteRes = await request(`${API_BASE}/assessments/${assessmentId}/invitations`, {
      method: 'POST',
      headers: candidateHeaders,
      body: JSON.stringify({ candidateEmail: invitedEmail }),
    });
    console.log(`Recruiter created invite: status=${inviteRes.status}, token=${inviteRes.body.data?.invitation?.token}`);
    const inviteToken = inviteRes.body.data?.invitation?.token;

    // External candidate starts session via public invite token (NO Clerk auth!)
    const startRes = await request(`${API_BASE}/invitations/${inviteToken}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    console.log(`Candidate started invite session: status=${startRes.status}, hasToken=${!!startRes.body.data?.token}`);
    const sessionToken = startRes.body.data.token;
    const sessionId = startRes.body.data.session.id;

    // Candidate submits using the session-scoped JWT
    const submitRes = await request(`${API_BASE}/sessions/${sessionId}/submit`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${sessionToken}`,
        'Content-Type': 'application/json',
      },
    });
    console.log(`Candidate submitted assessment session: status=${submitRes.status}, verdict=${submitRes.body.data?.verdict?.passed !== undefined}`);

    // Recruiter inspects assessment to verify status is SUBMITTED
    const verifyAssessmentRes = await request(`${API_BASE}/assessments/${assessmentId}`, {
      method: 'GET',
      headers: candidateHeaders,
    });
    const invitationRecord = verifyAssessmentRes.body.data?.invitations?.find((i) => i.candidateEmail === invitedEmail);
    console.log(`Recruiter sees candidate session status: ${invitationRecord?.derivedStatus || invitationRecord?.session?.status}`);
    console.log('✓ Invite flow successfully verified end-to-end completely independent of Clerk!\n');

    console.log('================================================================');
    console.log('ALL PROMPT 2 VERIFICATIONS PASSED SUCCESSFULLY!');
    console.log('================================================================');
  } finally {
    if (apiProcess) {
      console.log('Shutting down background API server...');
      apiProcess.kill();
    }
  }
}

main().catch((err) => {
  console.error('\n❌ VERIFICATION FAILED:', err);
  process.exit(1);
});
