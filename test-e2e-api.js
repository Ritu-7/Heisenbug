// test-e2e-api.js — Runs real API E2E checks for both problems
//
// NOTE: POST /api/auth/login no longer exists (returns 410 Gone).
// This app uses Clerk for browser authentication. For local/CI API testing we
// use the legacy JWT fallback path in requireAuth(), which accepts a JWT signed
// with JWT_SECRET. This path exists for the assessment-invite flow and seeded
// demo accounts.
//
// Requirements:
//   JWT_SECRET env var must be set (same value as the API server).
//   DATABASE_URL env var must be set (to look up Alice's user ID).
//   API must be running on 127.0.0.1:3001.

const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');

const API_BASE = 'http://127.0.0.1:3001/api';
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('ERROR: JWT_SECRET environment variable is required.');
  process.exit(1);
}

const prisma = new PrismaClient();

async function mintToken(email) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new Error(`Seeded user ${email} not found in database`);
  return jwt.sign(
    { sub: user.id, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: '1h' }
  );
}

async function request(url, options = {}) {
  const res = await fetch(url, options);
  const json = await res.json();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${JSON.stringify(json)}`);
  }
  return json;
}

async function main() {
  console.log('--- 1. Mint JWT for alice@heisenbug.dev (seeded demo account) ---');
  const token = await mintToken('alice@heisenbug.dev');
  console.log('✓ JWT minted for alice@heisenbug.dev');


  const authHeaders = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  console.log('\nFetching all problems...');
  const listRes = await request(`${API_BASE}/problems`, { headers: authHeaders });
  console.log('Problems in DB:', listRes.data.map(p => ({ slug: p.slug, versionId: p.currentVersion?.id })));

  for (const prob of listRes.data) {
    const slug = prob.slug;
    const versionId = prob.currentVersion?.id;
    if (!versionId) continue;

    console.log('\n==================================================');
    console.log(`TESTING ${slug}`);
    console.log('==================================================');

    console.log(`Creating session for ${slug}...`);
    const sRes = await request(`${API_BASE}/sessions`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ versionId, mode: 'PRACTICE' }),
    });
    const sessionId = sRes.data.id;
    console.log(`✓ Session created: ${sessionId}`);

    console.log('\nPOST /api/sessions/:id/run (unmodified starter code):');
    const runRes = await request(`${API_BASE}/sessions/${sessionId}/run`, {
      method: 'POST',
      headers: authHeaders,
    });
    console.log(JSON.stringify(runRes.data, null, 2));

    // Determine reference file path (.py or .js)
    const packDir = path.join(__dirname, 'packages', 'problems', slug);
    const refPath = fs.existsSync(path.join(packDir, 'solutions', 'reference.py'))
      ? path.join(packDir, 'solutions', 'reference.py')
      : path.join(packDir, 'solutions', 'reference.js');

    console.log('\nSaving reference solution code...');
    const refCode = fs.readFileSync(refPath, 'utf-8');
    await request(`${API_BASE}/sessions/${sessionId}/events`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        occurredAt: new Date().toISOString(),
        type: 'CODE_SAVE',
        payloadJson: { code: refCode }
      }),
    });

    console.log('\nPOST /api/sessions/:id/submit (reference solution):');
    const subRes = await request(`${API_BASE}/sessions/${sessionId}/submit`, {
      method: 'POST',
      headers: authHeaders,
    });
    console.log(JSON.stringify({
      score: subRes.data.submission.score,
      verdict: subRes.data.verdict,
    }, null, 2));

    // Check for bad patch
    const badPatchesDir = path.join(packDir, 'bad_patches');
    const badPatchFiles = fs.existsSync(badPatchesDir)
      ? fs.readdirSync(badPatchesDir).filter(f => f.endsWith('.js') || f.endsWith('.py'))
      : [];
    if (badPatchFiles.length > 0) {
      const badPatchPath = path.join(badPatchesDir, badPatchFiles[0]);
      console.log(`\nTesting bad patch (${badPatchFiles[0]})...`);
      const bpCode = fs.readFileSync(badPatchPath, 'utf-8');
      
      // Create new session for bad patch submit
      const bpSessionRes = await request(`${API_BASE}/sessions`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ versionId, mode: 'PRACTICE' }),
      });
      const bpSessionId = bpSessionRes.data.id;

      await request(`${API_BASE}/sessions/${bpSessionId}/events`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          occurredAt: new Date().toISOString(),
          type: 'CODE_SAVE',
          payloadJson: { code: bpCode }
        }),
      });

      console.log('POST /api/sessions/:id/submit (bad patch):');
      const bpSubRes = await request(`${API_BASE}/sessions/${bpSessionId}/submit`, {
        method: 'POST',
        headers: authHeaders,
      });
      console.log(JSON.stringify({
        score: bpSubRes.data.submission.score,
        verdict: bpSubRes.data.verdict,
      }, null, 2));
    }
  }

  console.log('\n✅ E2E API Verification Complete.');
  await prisma.$disconnect();
}

main().catch(async err => {
  console.error('Fatal E2E error:', err);
  await prisma.$disconnect();
  process.exit(1);
});
