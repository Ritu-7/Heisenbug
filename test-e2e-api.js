// test-e2e-api.js — Runs real API E2E checks for both problems
const fs = require('fs');
const path = require('path');

const API_BASE = 'http://127.0.0.1:3001/api';

async function request(url, options = {}) {
  const res = await fetch(url, options);
  const json = await res.json();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${JSON.stringify(json)}`);
  }
  return json;
}

async function main() {
  console.log('--- 1. Login ---');
  const loginRes = await request(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'alice@heisenbug.dev', password: 'testcandidate123' }),
  });
  const token = loginRes.token;
  console.log('✓ Logged in as alice@heisenbug.dev');

  const authHeaders = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  console.log('\nFetching all problems...');
  const listRes = await request(`${API_BASE}/problems`, { headers: authHeaders });
  console.log('Problems in DB:', listRes.data.map(p => ({ slug: p.slug, versionId: p.currentVersion?.id })));

  const p1 = listRes.data.find(p => p.slug === 'be-idempotency-001');
  const p2 = listRes.data.find(p => p.slug === 'be-race-002');

  if (!p1?.currentVersion?.id || !p2?.currentVersion?.id) {
    throw new Error('Missing problem versions in database! Did seed run?');
  }

  // ── Problem 1: be-idempotency-001 ───────────────────────────────────────
  console.log('\n==================================================');
  console.log('TESTING be-idempotency-001');
  console.log('==================================================');

  console.log('Creating session for be-idempotency-001...');
  const s1Res = await request(`${API_BASE}/sessions`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ versionId: p1.currentVersion.id, mode: 'PRACTICE' }),
  });
  const session1Id = s1Res.data.id;
  console.log(`✓ Session created: ${session1Id}`);

  console.log('\nPOST /api/sessions/:id/run (unmodified starter code):');
  const run1Res = await request(`${API_BASE}/sessions/${session1Id}/run`, {
    method: 'POST',
    headers: authHeaders,
  });
  console.log(JSON.stringify(run1Res.data, null, 2));

  console.log('\nSaving reference solution code...');
  const ref1Code = fs.readFileSync(
    path.join(__dirname, 'packages', 'problems', 'be-idempotency-001', 'solutions', 'reference.js'),
    'utf-8'
  );
  await request(`${API_BASE}/sessions/${session1Id}/events`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      occurredAt: new Date().toISOString(),
      type: 'CODE_SAVE',
      payloadJson: { code: ref1Code }
    }),
  });

  console.log('\nPOST /api/sessions/:id/submit (reference solution):');
  const sub1Res = await request(`${API_BASE}/sessions/${session1Id}/submit`, {
    method: 'POST',
    headers: authHeaders,
  });
  console.log(JSON.stringify({
    score: sub1Res.data.submission.score,
    verdict: sub1Res.data.verdict,
  }, null, 2));


  // ── Problem 2: be-race-002 ───────────────────────────────────────────────
  console.log('\n==================================================');
  console.log('TESTING be-race-002');
  console.log('==================================================');

  console.log('Creating session for be-race-002...');
  const s2Res = await request(`${API_BASE}/sessions`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ versionId: p2.currentVersion.id, mode: 'PRACTICE' }),
  });
  const session2Id = s2Res.data.id;
  console.log(`✓ Session created: ${session2Id}`);

  console.log('\nPOST /api/sessions/:id/run (unmodified starter code):');
  const run2Res = await request(`${API_BASE}/sessions/${session2Id}/run`, {
    method: 'POST',
    headers: authHeaders,
  });
  console.log(JSON.stringify(run2Res.data, null, 2));

  console.log('\nSaving reference solution code...');
  const ref2Code = fs.readFileSync(
    path.join(__dirname, 'packages', 'problems', 'be-race-002', 'solutions', 'reference.js'),
    'utf-8'
  );
  await request(`${API_BASE}/sessions/${session2Id}/events`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      occurredAt: new Date().toISOString(),
      type: 'CODE_SAVE',
      payloadJson: { code: ref2Code }
    }),
  });

  console.log('\nPOST /api/sessions/:id/submit (reference solution):');
  const sub2Res = await request(`${API_BASE}/sessions/${session2Id}/submit`, {
    method: 'POST',
    headers: authHeaders,
  });
  console.log(JSON.stringify({
    score: sub2Res.data.submission.score,
    verdict: sub2Res.data.verdict,
  }, null, 2));

  console.log('\n✅ E2E API Verification Complete.');
}

main().catch(err => {
  console.error('Fatal E2E error:', err);
  process.exit(1);
});
