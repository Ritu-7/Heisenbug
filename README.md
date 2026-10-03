# Heisenbug

Heisenbug is a real-world backend debugging and system design evaluation platform.

## Prerequisites

- **Node.js**: v20 or higher
- **npm**: v10 or higher
- **Docker**: Docker Desktop / Docker Engine (must be running for containerized grading and PostgreSQL)

---

## Setup & Local Development Steps

Follow these exact steps in order from the repository root:

### 1. Clone the repository
```bash
git clone https://github.com/heisenbug/heisenbug.git
cd heisenbug
```

### 2. Install dependencies
```bash
npm install
```

### 3. Start PostgreSQL container
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

- **Web App**: `http://localhost:3000`
- **API Server**: `http://localhost:3001`
- **Candidate User**: `alice@heisenbug.dev` / `testcandidate123`
- **Admin User**: `admin@heisenbug.dev` / `adminpassword123`
