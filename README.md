# Heisenbug

[![Validate Problems, Typecheck & E2E](https://github.com/Ritu-7/Heisenbug/actions/workflows/validate-problems.yml/badge.svg)](https://github.com/Ritu-7/Heisenbug/actions/workflows/validate-problems.yml)

Heisenbug is a real-world backend debugging and system design evaluation platform.

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
