# Software Requirements Specification (SRS) — Heisenbug

## Assessment Architecture & Deferred Capabilities

### 1. Assessment Scope (Single-Problem Assessments)
- **1:1 Mapping**: Each `Assessment` in Heisenbug currently scopes to exactly **one** problem pack (`ProblemVersion`).
- **Domain Alignment**: `Invitation` has a 1:1 foreign key relationship (`sessionId String? @unique`) with `Session`. Scoping an assessment to a single problem pack ensures that candidate invitations map cleanly to single Docker workspace sessions with precise time limits, isolated grading, and unequivocal completion statuses.

### 2. Multi-Problem Assessment Batteries (Deferred)
- **Status**: Deferred to future milestones.
- **Rationale**: Multi-problem assessment batteries (where a candidate completes multiple independent engineering tickets within a single overall assessment session) require multi-session tracking per invitation or an assessment battery entity. Scoping current assessments 1:1 with problem packs guarantees zero ambiguity across database contracts, API endpoints, and real-time container grading execution.

### 3. Third-Party OAuth Authentication (Deferred)
- **Status**: Deferred to future milestones.
- **Scope**: Social sign-in providers (GitHub, Google).
- **Rationale & External Dependency**: Implementing third-party OAuth flows requires registering OAuth client applications within each provider's developer console to obtain provider-issued credentials (`GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`) alongside configured redirect URIs for deployment domains. Because obtaining and managing these external credentials requires manual provider configuration outside the local/agentic runtime environment, OAuth is explicitly deferred rather than mocked with incomplete stubs. Primary authentication is fully implemented and enforced via bcrypt password hashing (cost 10), signed JWTs, and strict per-IP rate limiting on `POST /api/auth/login`.

### 4. Transactional Email Features: Password Reset & Email Verification (Deferred)
- **Status**: Deferred to future milestones.
- **Scope**: Self-service password reset flows (`/forgot-password`, `/reset-password`), email address verification, and automated invitation delivery.
- **Rationale & External Dependency**: Automated password reset links and verification tokens require an integrated transactional email transport service (e.g., Resend, SendGrid, AWS SES) and verified DNS domain authentication (SPF, DKIM, DMARC). This follows the exact same dependency model as assessment invitation delivery, already explicitly documented in `apps/api/src/routes/assessments.ts` (line 219: `// TODO: Send real email to candidateEmail with inviteUrl below`). To avoid fragile or misleading stub implementations, all email-dependent capabilities are deferred in tandem until a centralized mail transport provider is provisioned. Currently, invitation URLs are generated securely via cryptographically random CUID tokens and returned directly in API responses for recruiters to distribute, while authentication security is maintained through rate-limited login endpoints and server-enforced JWT expiration.

### 5. Role-Based Access Control Architecture & The AUTHOR Role
- **Status**: Defined in schema and seeded; API authoring endpoints deferred.
- **Scope**: Roles are `CANDIDATE`, `RECRUITER`, `ADMIN`, and `AUTHOR`.
- **Enforcement Architecture**: Enforced using the shared `requireRole(...roles)` middleware (`apps/api/src/middleware/auth.ts`) chained after `requireAuth`.
- **The AUTHOR Role**: Problem packs are currently filesystem-based (`packages/problems/*`) and seeded into Postgres via database migrations/seed scripts (`prisma/seed.ts`), rather than submitted via dynamic web forms. Because no dynamic problem authoring, version drafting, or packaging endpoints exist yet in the API, the `AUTHOR` role is defined in `schema.prisma` and present in seed fixtures, but intentionally unenforced across existing runtime routes. Future problem-authoring endpoints (e.g., `POST /api/problems`, `POST /api/problems/:slug/versions`, `POST /api/problems/:slug/publish`) will gate exclusively on `requireRole("AUTHOR", "ADMIN")`.

### 6. Administrator Privileges & Deferred Admin Capabilities (FR-ADM)
- **Current Real Enforcement**: The `ADMIN` role is gated distinctly from `RECRUITER` via `GET /api/admin/users`, an administrative endpoint requiring `requireRole("ADMIN")` (RECRUITER, AUTHOR, and CANDIDATE users receive HTTP 403 Forbidden). `ADMIN` also possesses system-wide object-level override privileges across sessions, submissions, and assessments.
- **Deferred FR-ADM Capabilities**: Advanced enterprise administrative capabilities—including user suspension/deactivation, candidate abuse flagging, automated plagiarism detection, and container runner pool telemetry dashboards—are deferred to future administrative console milestones.

### 7. Problem Catalog & Starter Code Public Access Stance
- **Decision**: Public (unauthenticated) access maintained for `GET /api/problems`, `GET /api/problems/:slug`, and `GET /api/problems/:slug/starter-code`.
- **Rationale**: Permitting unauthenticated catalog browsing allows prospective candidates, talent partners, and developers to explore available challenges, difficulty tiers, tech stacks, and starter files before registering or logging in, minimizing onboarding friction. No sensitive data, hidden test cases, or grading solutions are leaked through these endpoints. All stateful or interactive operations—including session creation, code snapshot persistence, container test execution, submission recording, and assessment invitations—remain strictly protected behind `requireAuth`.
