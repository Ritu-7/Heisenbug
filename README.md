# Heisenbug

[![Validate Problems, Typecheck & E2E](https://github.com/Ritu-7/Heisenbug/actions/workflows/validate-problems.yml/badge.svg)](https://github.com/Ritu-7/Heisenbug/actions/workflows/validate-problems.yml)

## Project Overview

Heisenbug is a technical assessment platform where candidates fix real-world, ticket-style engineering bugs—such as concurrency races, machine learning data leakage, cross-site scripting (XSS), and database N+1 query bottlenecks—instead of solving algorithmic trivia. Candidate submissions are executed and verified against hidden test suites inside isolated Docker containers that the candidate never sees.

Currently, **5 of 5** production problem packs are fully seeded and published in the database across three engineering tracks:
- **Backend**: *Checkout double-charges on client retry* (`be-idempotency-001`) — Node/Express, idempotency keys, distributed concurrency.
- **Backend**: *Inventory oversells during a flash sale* (`be-race-002`) — Transaction isolation, race conditions, atomic conditional updates.
- **Backend**: *Optimize N+1 Query in Order History API* (`be-nplusone-001`) — Relational batch fetching, query optimization *(restored and published in the production database)*.
- **Security**: *Comment previews execute attacker-controlled HTML* (`sec-xss-001`) — Stored/DOM XSS, input sanitization, safe DOM sinks.
- **Machine Learning**: *Churn model scores 96% in testing, barely beats a coin flip in production* (`ml-leakage-001`) — Data leakage, temporal train/test splitting, baseline calibration.

---

## Live Demo

- **Web Application**: [https://heisenbug.vercel.app](https://heisenbug.vercel.app)
- **API Server**: [https://heisenbug-api.onrender.com](https://heisenbug-api.onrender.com)

> **Note on Cold Starts**: The API server is hosted on Render's free tier and spins down during periods of inactivity. Please allow 30–60 seconds for the service to wake up on the initial request.

---

## Architecture Overview

Heisenbug is architected as a modular TypeScript monorepo combining a modern web frontend, an Express orchestration API, and containerized evaluation runners:

```
       ┌────────────────────────┐
       │   Next.js Web App      │ (Vercel)
       │  Monaco Editor / Replay│
       └───────────┬────────────┘
                   │ HTTPS / Clerk Auth
       ┌───────────▼────────────┐
       │     Express.js API     │ (Render)
       └──┬─────────┬─────────┬─┘
          │         │         │
    Prisma│   Docker│   Gemini│
          │         │         │
┌─────────▼──┐  ┌───▼──────────────┐  ┌──────────▼───────────┐
│ PostgreSQL │  │ Docker Runners   │  │ Google Gemini API    │
│   (Neon)   │  │ - Session Runner │  │ - AI Problem Author  │
└────────────┘  │ - Grader Runner  │  │ - Socratic Mentor    │
                └──────────────────┘  └──────────────────────┘
```

- **Next.js Frontend (`apps/web`)**: Next.js App Router, React 19, Tailwind CSS, Monaco Editor, and TanStack Query powering candidate workspaces, recruiter portals, and administrative views.
- **Express API (`apps/api`)**: Node.js/Express service orchestrating Docker container lifecycles, session state, Gemini AI integration, and telemetry ingestion.
- **Database (`packages/db`)**: PostgreSQL (Neon) with Prisma ORM persisting problems, version history, test sessions, candidate event streams, submissions, and recruiter assessments.
- **Authentication**: Managed via [Clerk](https://clerk.com) for candidate, recruiter, and administrator identities with role-based access control (`CANDIDATE`, `RECRUITER`, `ADMIN`) synced via signed Svix webhooks. Passwordless timed assessment invitations use session-scoped JWT tokens.
- **Docker-Based Grading Engine**:
  - **Session Runner (`heisenbug-session-runner`)**: Runs candidate-triggered visible tests against code modifications in real time.
  - **Grader Runner (`heisenbug-grader-runner`)**: Executes the full suite of visible and hidden tests with build-time isolation. Hidden test suites, fixtures, and grading harnesses are baked directly into the grader container image at build time, ensuring candidate code cannot inspect, alter, or mock evaluation criteria.
  *(Note: MicroVM sandboxing like gVisor or Firecracker represents a planned future enhancement; Docker container isolation is the active, implemented engine.)*

---

## Key Features

- **Docker-Isolated Grading with 4-Stage Validation Pipeline**: Every problem pack must pass a deterministic 4-stage validation pipeline (`packages/problems/validate.ts`) before publication:
  1. *Starter Code Failure*: Confirms unmodified starter code fails hidden tests (`score < 100`).
  2. *Reference Solution Pass*: Confirms canonical reference solution achieves 100/100 on both visible and hidden test suites.
  3. *Grader Consistency*: Executes 5 consecutive grader runs on the reference solution with zero flakiness or timeouts.
  4. *Bad Patch Rejection*: Verifies that common near-misses and incomplete fixes pass visible checks but are rejected by hidden checks.
- **AI-Assisted Problem Authoring**: Authoring pipeline using Google Gemini (`apps/api/src/services/ai-author.ts`) to draft descriptions, starter code, test suites, and reference solutions, strictly validated by the 4-stage pipeline before being seeded to the database.
- **Socratic AI Coding Mentor**: Practice-mode assistant (`apps/api/src/routes/mentor.ts`) providing progressive nudges and conceptual debugging guidance, protected by verified prompt constraints that forbid generating code solutions or complete patches.
- **Role-Based Access & Recruiter Approval Workflow**: Three-tier RBAC (`CANDIDATE`, `RECRUITER`, `ADMIN`). Recruiter registrations require explicit administrative approval before invitations or reports can be created.
- **Timed, Token-Gated Assessment Invitations**: Candidate assessment sessions gated by single-use invitation tokens with real-time countdown timers. Practice aids (hints, editorial, and solution tabs) are unconditionally locked during live assessments.
- **Interactive Session Replay & Candidate Telemetry**: Real-time event tracking capturing timestamps for code edits, test runs, hint usage, and final submissions (`apps/web/src/components/session-replay.tsx` & `apps/api/src/routes/postmortems.ts`). Recruiters can scrub through the candidate's exact problem-solving process with play/pause controls, inspect intermediate diffs, and generate shareable postmortem summaries.
- **Automated CI Pipeline**: GitHub Actions (`.github/workflows/validate-problems.yml`) executing Docker-based problem validation, TypeScript typechecks across all monorepo packages, and Playwright end-to-end tests on every push.

---

## Tech Stack

| Component | Technology |
|---|---|
| **Frontend** | Next.js 15, React 19, TypeScript, Tailwind CSS, Monaco Editor, Lucide Icons, Framer Motion, TanStack Query |
| **Backend API** | Express.js, TypeScript, Docker Engine SDK, Svix, JSON Web Tokens |
| **Database & ORM** | PostgreSQL (Neon serverless connection pooler), Prisma ORM |
| **Execution Sandboxes** | Docker containers (`heisenbug-session-runner`, `heisenbug-grader-runner`) |
| **Authentication** | Clerk (JWT verification, role claims, Svix webhooks) |
| **Artificial Intelligence** | Google Gemini API (`gemini-1.5-pro` & `gemini-1.5-flash`) |
| **Testing & CI** | Playwright (E2E), Jest (Problem test suites), GitHub Actions |

---

## Prerequisites

- **Node.js**: v20 or higher
- **npm**: v10 or higher
- **Docker**: Docker Desktop / Docker Engine (must be running for containerized grading and PostgreSQL)

---

## Environment Configuration

Authentication is managed via [Clerk](https://clerk.com). Passwords and session verification are delegated to Clerk, with user records synced to PostgreSQL via signed Svix webhooks.

Configure the following variables in `apps/api/.env` and `apps/web/.env.local`:

```env
# Clerk Authentication
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY="pk_test_..."
CLERK_PUBLISHABLE_KEY="pk_test_..."
CLERK_SECRET_KEY="sk_test_..."
CLERK_WEBHOOK_SECRET="whsec_..."

# Single-Use Assessment Invitation Tokens
JWT_SECRET="<random-secure-secret>"

# Database
DATABASE_URL="postgresql://user:pass@host:5432/heisenbug?sslmode=require"
```

> **Note:** Legacy bcrypt password authentication and custom JWT login endpoints have been completely retired. Passwordless assessment candidate invitations use session-scoped tokens signed by `JWT_SECRET`.

---

## Setup & Local Development Steps

Follow these exact steps in order from the repository root:

### 1. Clone the repository
```bash
git clone https://github.com/Ritu-7/Heisenbug.git
cd Heisenbug
```

### 2. Install dependencies
```bash
npm install
```

### 3. Start PostgreSQL container (if running locally)
```bash
docker compose up -d
```

### 4. Run database migrations
```bash
npm run db:migrate
```

### 5. Seed the database
```bash
npm run db:seed
```

### 6. Build the runner Docker images
Build both `heisenbug-session-runner` and `heisenbug-grader-runner` images:
```bash
npm run docker:build
```

### 7. Start local development servers
Starts the Express API server (port 3001) and Next.js web application (port 3000):
```bash
npm run dev
```

---

## Access & Test Credentials

Each portal is scoped to specific user roles:
- **Candidate Portal** (`/login`): `alice@heisenbug.dev` / `Heisenbug_Alice_Rotated_2026_Secure!`
- **Recruiter Portal** (`/recruiter/login`): `recruiter@heisenbug.dev` / `Heisenbug_Recruiter_Rotated_2026_Secure!`
- **Administrator Console** (`/admin/login`): `admin@heisenbug.dev` / `Heisenbug_Admin_Rotated_2026_Secure!`
