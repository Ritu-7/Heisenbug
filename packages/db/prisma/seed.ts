import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

// ─── Problem description ──────────────────────────────────────────────────
const DESCRIPTION_MD = `# PAY-482 · Checkout double-charges on client retry

**Track:** Backend · **Difficulty:** Medium · **Est. time:** 30 min  
**Skills:** idempotency · concurrency · payments  
**Stack:** Node.js · Express · PostgreSQL

---

## Ticket context

**Reported by:** Support (Tier-2 escalation)  
**Severity:** 🔴 High  
**Affects:** Production — checkout flow  
**Reproducibility:** Consistent on flaky network / mobile clients

### User-facing symptom

When a customer's network drops mid-checkout and the mobile client retries the
\`POST /checkout\` request, the payment processor charges the card **twice**
(sometimes three times). Stripe's dashboard shows distinct \`PaymentIntent\`
objects for each retry — meaning our server is creating a new intent on every
call instead of returning the result of the first successful one.

### Reproduction steps

1. Start a checkout (\`POST /checkout\` with a valid cart + Stripe test card).
2. Before the response arrives, disconnect the network and trigger a retry
   (the mobile client retries after 3 s).
3. Reconnect. Both requests complete with \`201 Created\`.
4. Stripe dashboard → two \`PaymentIntent\` charges on the same card for the
   same order amount.

### Root-cause area (your job is to fix it)

\`src/routes/checkout.ts\` — the handler creates a \`PaymentIntent\` and an
\`Order\` row on **every** request without checking whether an equivalent request
already completed.

---

## Codebase tour

\`\`\`
src/
  routes/
    checkout.ts        ← entry point you will edit
  services/
    paymentService.ts  ← thin wrapper around stripe-node
    orderService.ts    ← creates Order rows in the DB
  db/
    client.ts          ← shared Prisma client
  middleware/
    auth.ts            ← sets req.user
prisma/
  schema.prisma        ← Order, Payment, IdempotencyKey models already present
\`\`\`

---

## Requirements you must satisfy

### R1 — Accept and honour an idempotency key
- Clients send \`Idempotency-Key: <uuid>\` in the request header.
- If no key is present, respond **\`400 Bad Request\`** with body
  \`{ "error": "Idempotency-Key header is required" }\`.
- Store each key in the \`idempotency_keys\` table (columns: \`key\`, \`user_id\`,
  \`response_status\`, \`response_body\`, \`created_at\`).

### R2 — Correct HTTP status semantics
| Scenario | Status |
|---|---|
| First successful checkout | **201 Created** |
| Retry with same key (result already stored) | **200 OK** (replay stored response) |
| Concurrent duplicate (key locked but not finished) | **409 Conflict** with \`{ "error": "Request in progress" }\` |
| Missing or invalid payload | **400 Bad Request** |

### R3 — Prevent concurrent duplicate processing
- Use a **PostgreSQL advisory lock** (or a \`SELECT … FOR UPDATE\` on the
  idempotency key row) so that two simultaneous retries cannot both proceed to
  create a PaymentIntent.
- The second concurrent request must receive **409** immediately, not wait
  indefinitely.

### R4 — Atomicity
- Inserting the \`IdempotencyKey\` row, calling \`paymentService.createIntent()\`,
  and inserting the \`Order\` row must be wrapped in a **single database
  transaction**.
- If \`createIntent\` throws, the key row must be rolled back (so the client can
  retry with the same key later).

### R5 — Tests (not graded for this problem but expected to compile)
A test file \`src/routes/checkout.test.ts\` already exists with 6 \`it()\` blocks
(all currently failing). Your implementation should make them pass.

---

## Constraints

- Do **not** change the Stripe API call signature inside \`paymentService.ts\`.
- Do **not** change the \`Order\` model in \`schema.prisma\`.
- You may add columns to \`idempotency_keys\` if needed but may not remove
  existing ones.
- TypeScript strict mode is on; no \`any\` casts.

---

## Acceptance criteria (auto-checked)

| ID | Check | Weight |
|----|-------|--------|
| AC-1 | Missing \`Idempotency-Key\` header → 400 | 10 |
| AC-2 | First call → 201 + \`PaymentIntent\` created once in Stripe | 20 |
| AC-3 | Retry with same key → 200 + **no** new \`PaymentIntent\` | 25 |
| AC-4 | Concurrent duplicate → 409 within 500 ms | 20 |
| AC-5 | DB transaction rolled back on Stripe error | 15 |
| AC-6 | TypeScript compiles with \`tsc --noEmit\` | 10 |

Total: **100 points** · Pass threshold: **70**
`;

async function main() {
  console.log("🌱 Seeding database...");

  // ── Seed test candidate user ─────────────────────────────────────────────
  // Password: "testcandidate123" (bcrypt, cost 10)
  const CANDIDATE_EMAIL = "alice@heisenbug.dev";
  const CANDIDATE_PASSWORD = "testcandidate123";
  const passwordHash = await bcrypt.hash(CANDIDATE_PASSWORD, 10);

  const candidate = await prisma.user.upsert({
    where: { email: CANDIDATE_EMAIL },
    update: { passwordHash },
    create: {
      email: CANDIDATE_EMAIL,
      name: "Alice Candidate",
      role: "CANDIDATE",
      passwordHash,
    },
  });
  console.log(`  ✓ Candidate user: ${candidate.id} (${candidate.email})`);

  // ── Seed admin user ─────────────────────────────────────────────────────
  const ADMIN_EMAIL = "admin@heisenbug.dev";
  const ADMIN_PASSWORD = "adminpassword123";
  const adminHash = await bcrypt.hash(ADMIN_PASSWORD, 10);

  const admin = await prisma.user.upsert({
    where: { email: ADMIN_EMAIL },
    update: { passwordHash: adminHash },
    create: {
      email: ADMIN_EMAIL,
      name: "Heisenbug Admin",
      role: "ADMIN",
      passwordHash: adminHash,
    },
  });
  console.log(`  ✓ Admin user:     ${admin.id} (${admin.email})`);

  // ── Seed problem ─────────────────────────────────────────────────────────
  const problem = await prisma.problem.upsert({
    where: { slug: "be-idempotency-001" },
    update: {},
    create: {
      slug: "be-idempotency-001",
      title: "Checkout double-charges on client retry",
      track: "backend",
      difficulty: "medium",
      estMinutes: 30,
      skills: ["idempotency", "concurrency", "payments"],
      stack: "node-express-postgres",
    },
  });
  console.log(`  ✓ Problem: ${problem.id} (${problem.slug})`);

  // ── Seed problem version ─────────────────────────────────────────────────
  const existingVersion = await prisma.problemVersion.findUnique({
    where: { problemId_version: { problemId: problem.id, version: 1 } },
  });

  let version;
  if (existingVersion) {
    version = await prisma.problemVersion.update({
      where: { id: existingVersion.id },
      data: { status: "PUBLISHED", descriptionMd: DESCRIPTION_MD },
    });
  } else {
    version = await prisma.problemVersion.create({
      data: {
        problemId: problem.id,
        version: 1,
        status: "PUBLISHED",
        descriptionMd: DESCRIPTION_MD,
        editorialMd: "",
        solutionMd: "",
      },
    });
  }
  console.log(`  ✓ ProblemVersion: ${version.id} (v${version.version}, ${version.status})`);

  // ── Seed default variant ─────────────────────────────────────────────────
  const variantId = `${version.id}_default`;
  const variant = await prisma.variant.upsert({
    where: { id: variantId },
    update: {},
    create: {
      id: variantId,
      versionId: version.id,
      paramsJson: {
        variant: "default",
        stripeDelayMs: 0,
        concurrentRequests: 2,
      },
    },
  });
  console.log(`  ✓ Variant:        ${variant.id}`);

  console.log("\n✅ Seed complete.");
  console.log("\n📋 Test credentials:");
  console.log(`   Candidate: ${CANDIDATE_EMAIL} / ${CANDIDATE_PASSWORD}`);
  console.log(`   Admin:     ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
