// test-rate-limit-proof.js
const API_BASE = "http://localhost:3001/api";

async function testLoginRateLimit() {
  console.log("=== 1. TEST POST /api/auth/login RATE LIMITING ===");
  console.log("Testing 7 consecutive login attempts with bad credentials...\n");

  const results = [];
  for (let attempt = 1; attempt <= 7; attempt++) {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "alice@heisenbug.dev",
        password: "wrongpassword123",
      }),
    });

    const status = res.status;
    const rateLimitRemaining = res.headers.get("ratelimit-remaining") ?? res.headers.get("x-ratelimit-remaining");
    const json = await res.json().catch(() => ({}));

    results.push({ attempt, status, rateLimitRemaining, body: json });

    console.log(
      `Attempt ${attempt}: HTTP ${status} | Remaining: ${rateLimitRemaining ?? "N/A"} | Body: ${JSON.stringify(json)}`
    );
  }

  const attempts1to5 = results.slice(0, 5).every((r) => r.status === 401);
  const attempts6and7 = results.slice(5).every((r) => r.status === 429);

  if (attempts1to5 && attempts6and7) {
    console.log("\n✓ PASS: Attempts 1-5 returned HTTP 401 (Invalid credentials).");
    console.log("✓ PASS: Attempts 6-7 returned HTTP 429 (Too many login attempts). Rate limiter enforced!\n");
  } else {
    throw new Error(`Login rate limit sequence failed: ${results.map((r) => r.status).join(", ")}`);
  }
}

async function testInvitationRateLimit() {
  console.log("=== 2. TEST POST /api/invitations/:token/start RATE LIMITING ===");
  console.log("Testing 12 consecutive start attempts with garbage token...\n");

  const results = [];
  for (let attempt = 1; attempt <= 12; attempt++) {
    const res = await fetch(`${API_BASE}/invitations/invalid-test-token-hammer/start`, {
      method: "POST",
    });

    const status = res.status;
    const rateLimitRemaining = res.headers.get("ratelimit-remaining") ?? res.headers.get("x-ratelimit-remaining");
    const json = await res.json().catch(() => ({}));

    results.push({ attempt, status, rateLimitRemaining, body: json });

    console.log(
      `Attempt ${attempt}: HTTP ${status} | Remaining: ${rateLimitRemaining ?? "N/A"} | Body: ${JSON.stringify(json)}`
    );
  }

  const attempts1to10 = results.slice(0, 10).every((r) => r.status === 404);
  const attempts11and12 = results.slice(10).every((r) => r.status === 429);

  if (attempts1to10 && attempts11and12) {
    console.log("\n✓ PASS: Attempts 1-10 returned HTTP 404 (Invitation not found).");
    console.log("✓ PASS: Attempts 11-12 returned HTTP 429 (Too many assessment start attempts). Rate limiter enforced!\n");
  } else {
    throw new Error(`Invitation rate limit sequence failed: ${results.map((r) => r.status).join(", ")}`);
  }
}

async function main() {
  await testLoginRateLimit();
  await testInvitationRateLimit();
  console.log("==================================================");
  console.log("✅ ALL RATE LIMITING PROOFS PASSED PERFECTLY!");
  console.log("==================================================");
}

main().catch((err) => {
  console.error("\n❌ Test failed:", err.message);
  process.exit(1);
});
