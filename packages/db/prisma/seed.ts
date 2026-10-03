import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

// ─── Problem description ──────────────────────────────────────────────────
const DESCRIPTION_MD = `# PAY-482 · Checkout double-charges on client retry

**Track:** Backend · **Difficulty:** Medium · **Est. time:** 30 min  
**Skills:** idempotency · concurrency · payments  
**Stack:** Node.js · Express · JavaScript

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

\`src/charge.js\` — the \`handleCheckout\` function creates a \`PaymentIntent\` and an
\`order\` record on **every** request without checking whether an equivalent request
already completed.

---

## Codebase tour

\`\`\`
src/
  charge.js          ← entry point you will edit
  app.js             ← Express app wrapper
  db/
    client.js        ← in-memory stateful database stub
\`\`\`

---

## Requirements you must satisfy

### R1 — Accept and honour an idempotency key
- Clients send \`Idempotency-Key: <uuid>\` in the request header.
- If no key is present, respond **\`400 Bad Request\`** with body
  \`{ "error": "Idempotency-Key header is required" }\`.
- Check and store each key in the database via \`db.idempotencyKey\` stub methods.

### R2 — Correct HTTP status semantics
| Scenario | Status |
|---|---|
| First successful checkout | **201 Created** |
| Retry with same key (result already stored) | **200 OK** (replay stored response) |
| Concurrent duplicate (key locked but not finished) | **409 Conflict** with \`{ "error": "Request already in progress — retry after 1s" }\` |
| Missing header | **400 Bad Request** |

### R3 — Prevent concurrent duplicate processing
- Use an atomic database constraint via \`db.idempotencyKey.create(...)\` so that simultaneous retries cannot both proceed to create a \`PaymentIntent\`.
- The concurrent duplicate request must receive **409 Conflict** immediately.

### R4 — Atomicity & Error Handling
- Wrap state updates in \`db.$transaction(async (tx) => { ... })\`.
- If \`stripe.paymentIntents.create()\` fails or throws an error, the key must NOT be persisted with status \`COMPLETE\`.

---

## Acceptance criteria (auto-checked)

| ID | Suite | Check | Weight |
|----|-------|-------|--------|
| V1 | Visible | Returns 400 if \`Idempotency-Key\` header is missing | 10 pts |
| V2 | Visible | Returns 201 with \`clientSecret\` on first call | 20 pts |
| V3 | Visible | Returns 200 on replay; Stripe called only once | 30 pts |
| H1 | Hidden | Concurrent duplicate requests → 1× 201, rest return 409 | 15 pts |
| H2 | Hidden | If Stripe throws, idempotency key is NOT marked \`COMPLETE\` | 15 pts |
| H3 | Hidden | Three sequential retries all return identical response | 10 pts |

**Visible total:** 60 pts · **Hidden total:** 40 pts · **Grand total:** 100 pts
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
