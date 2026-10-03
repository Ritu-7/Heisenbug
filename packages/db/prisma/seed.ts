import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

// ─── Problem 1: be-idempotency-001 ───────────────────────────────────────────
const DESCRIPTION_MD_IDEMPOTENCY = `# PAY-482 · Checkout double-charges on client retry

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

// ─── Problem 2: be-race-002 ───────────────────────────────────────────────────
const DESCRIPTION_MD_RACE = `# FLASH-099 · Inventory oversells during a flash sale

**Track:** Backend · **Difficulty:** Medium · **Est. time:** 30 min  
**Skills:** race conditions · transactions · inventory  
**Stack:** Node.js · Express · JavaScript

---

## Ticket context

**Reported by:** Engineering (on-call alert)  
**Severity:** 🔴 High  
**Affects:** Production — flash sale purchase flow  
**Reproducibility:** Occurs under concurrent load (> 5 req/s per product)

### User-facing symptom

During a flash sale for a limited-edition item (stock: 10 units), the system
allowed **14 purchases** to complete successfully. The \`quantity\` field in the
database shows \`-4\` after the sale. Fulfilment is now raising chargebacks because
they cannot ship units that don't exist.

### Reproduction steps

1. Set a product's stock to \`N\`.
2. Fire \`N + 1\` simultaneous \`POST /purchase\` requests for that product.
3. Observe: more than \`N\` requests return \`200 OK\`, and the final stock goes negative.

### Root-cause area (your job is to fix it)

\`src/charge.js\` — the \`handlePurchase\` handler reads stock, checks \`quantity > 0\`,
then decrements — but without any locking. Between the read and the decrement,
other concurrent requests can read the same positive stock value, pass the check,
and all decrement simultaneously, pushing \`quantity\` below zero.

---

## Codebase tour

\`\`\`
src/
  charge.js          ← entry point you will edit
  app.js             ← Express app wrapper
  db/
    client.js        ← in-memory stateful stock stub (yields to event loop between read and write)
\`\`\`

---

## Requirements you must satisfy

### R1 — Atomic check-and-decrement
- Wrap the stock read-check-decrement in \`db.$transaction(async (tx) => { ... })\`.
- Inside the transaction, use \`tx.stock.findUnique\` and \`tx.stock.update\`.
- This eliminates the race window between read and write.

### R2 — Correct HTTP status semantics
| Scenario | Status |
|---|---|
| Stock available — purchase succeeds | **200 OK** with \`{ productId, remaining }\` |
| Stock is 0 (or goes to 0 before your decrement) | **409 Conflict** with \`{ "error": "Out of stock" }\` |
| \`productId\` field missing from request body | **400 Bad Request** |
| Product not found in database | **404 Not Found** |

### R3 — Stock never goes negative
- After any number of concurrent purchases, \`remaining\` values returned must
  all be ≥ 0.
- The number of successful (\`200 OK\`) responses must never exceed the initial
  stock quantity.

---

## Acceptance criteria (auto-checked)

| ID | Suite | Check | Weight |
|----|-------|-------|--------|
| V1 | Visible | Single purchase decrements stock by 1 | 10 pts |
| V2 | Visible | Returns 409 when stock is 0 | 20 pts |
| V3 | Visible | Purchasing exactly the remaining stock succeeds | 30 pts |
| H1 | Hidden | N concurrent requests with stock N-1 → exactly 1 rejected, stock never negative | 25 pts |
| H2 | Hidden | Stress: 20 concurrent requests against stock of 10, stock never goes negative | 15 pts |

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

  // ── Seed recruiter user ───────────────────────────────────────────────────
  const RECRUITER_EMAIL = "recruiter@heisenbug.dev";
  const RECRUITER_PASSWORD = "recruiterpassword123";
  const recruiterHash = await bcrypt.hash(RECRUITER_PASSWORD, 10);

  const recruiter = await prisma.user.upsert({
    where: { email: RECRUITER_EMAIL },
    update: { passwordHash: recruiterHash },
    create: {
      email: RECRUITER_EMAIL,
      name: "Dana Recruiter",
      role: "RECRUITER",
      passwordHash: recruiterHash,
    },
  });
  console.log(`  ✓ Recruiter user: ${recruiter.id} (${recruiter.email})`);

  // ── Seed problem 1: be-idempotency-001 ───────────────────────────────────
  const problem1 = await prisma.problem.upsert({
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
  console.log(`  ✓ Problem: ${problem1.id} (${problem1.slug})`);

  // ── Seed problem version 1 ───────────────────────────────────────────────
  const existingVersion1 = await prisma.problemVersion.findUnique({
    where: { problemId_version: { problemId: problem1.id, version: 1 } },
  });

  let version1;
  if (existingVersion1) {
    version1 = await prisma.problemVersion.update({
      where: { id: existingVersion1.id },
      data: { status: "PUBLISHED", descriptionMd: DESCRIPTION_MD_IDEMPOTENCY },
    });
  } else {
    version1 = await prisma.problemVersion.create({
      data: {
        problemId: problem1.id,
        version: 1,
        status: "PUBLISHED",
        descriptionMd: DESCRIPTION_MD_IDEMPOTENCY,
        editorialMd: "",
        solutionMd: "",
      },
    });
  }
  console.log(`  ✓ ProblemVersion: ${version1.id} (v${version1.version}, ${version1.status})`);

  // ── Seed default variant for problem 1 ───────────────────────────────────
  const variantId1 = `${version1.id}_default`;
  const variant1 = await prisma.variant.upsert({
    where: { id: variantId1 },
    update: {},
    create: {
      id: variantId1,
      versionId: version1.id,
      paramsJson: {
        variant: "default",
        stripeDelayMs: 0,
        concurrentRequests: 2,
      },
    },
  });
  console.log(`  ✓ Variant:        ${variant1.id}`);

  // ── Seed problem 2: be-race-002 ──────────────────────────────────────────
  const problem2 = await prisma.problem.upsert({
    where: { slug: "be-race-002" },
    update: {},
    create: {
      slug: "be-race-002",
      title: "Inventory oversells during a flash sale",
      track: "backend",
      difficulty: "medium",
      estMinutes: 30,
      skills: ["race-conditions", "transactions", "inventory"],
      stack: "node-express-postgres",
    },
  });
  console.log(`  ✓ Problem: ${problem2.id} (${problem2.slug})`);

  // ── Seed problem version 2 ───────────────────────────────────────────────
  const existingVersion2 = await prisma.problemVersion.findUnique({
    where: { problemId_version: { problemId: problem2.id, version: 1 } },
  });

  let version2;
  if (existingVersion2) {
    version2 = await prisma.problemVersion.update({
      where: { id: existingVersion2.id },
      data: { status: "PUBLISHED", descriptionMd: DESCRIPTION_MD_RACE },
    });
  } else {
    version2 = await prisma.problemVersion.create({
      data: {
        problemId: problem2.id,
        version: 1,
        status: "PUBLISHED",
        descriptionMd: DESCRIPTION_MD_RACE,
        editorialMd: "",
        solutionMd: "",
      },
    });
  }
  console.log(`  ✓ ProblemVersion: ${version2.id} (v${version2.version}, ${version2.status})`);

  // ── Seed default variant for problem 2 ───────────────────────────────────
  const variantId2 = `${version2.id}_default`;
  const variant2 = await prisma.variant.upsert({
    where: { id: variantId2 },
    update: {},
    create: {
      id: variantId2,
      versionId: version2.id,
      paramsJson: {
        variant: "default",
        concurrentRequests: 5,
        stockLevel: 10,
      },
    },
  });
  console.log(`  ✓ Variant:        ${variant2.id}`);

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

