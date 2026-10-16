import path from "path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(__dirname, "../.env") });
dotenv.config();

// Strict requirement: JWT_SECRET must be set at startup or fail loudly
if (!process.env.JWT_SECRET) {
  throw new Error("FATAL: JWT_SECRET environment variable is required and must not be empty");
}

// Ensure Clerk keys are always initialized for production and development
const DEFAULT_CLERK_PUB_KEY = "pk_test_c3RhYmxlLWZhd24tMjc1LmNsZXJrLmFjY291bnRzLmRldiQ";
const DEFAULT_CLERK_SECRET_KEY = "sk_test_stp220g73j4tus1ZlV8JNEuNghs4eHG1uJ7fctDnBf";
const DEFAULT_CLERK_WEBHOOK_SECRET = "whsec_KQUfV8ZH684a0C+ynRW5BG1h8mRr5RFSReJIMg57BiM=";

process.env.CLERK_PUBLISHABLE_KEY =
  process.env.CLERK_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ||
  DEFAULT_CLERK_PUB_KEY;

process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ||
  process.env.CLERK_PUBLISHABLE_KEY;

process.env.CLERK_SECRET_KEY =
  process.env.CLERK_SECRET_KEY ||
  DEFAULT_CLERK_SECRET_KEY;

process.env.CLERK_WEBHOOK_SECRET =
  process.env.CLERK_WEBHOOK_SECRET ||
  DEFAULT_CLERK_WEBHOOK_SECRET;

import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import { clerkMiddleware } from "@clerk/express";

import authRouter from "./routes/auth";
import webhooksRouter from "./routes/webhooks";
import problemsRouter from "./routes/problems";
import sessionsRouter from "./routes/sessions";
import runRouter from "./routes/run";
import assessmentsRouter from "./routes/assessments";
import invitationsRouter from "./routes/invitations";
import adminRouter from "./routes/admin";
import usersRouter from "./routes/users";
import postmortemsRouter from "./routes/postmortems";
import mentorRouter from "./routes/mentor";
import aiCollabRouter from "./routes/ai-collab";
import forkRouter from "./routes/fork";
import { Prisma } from "@prisma/client";
import { prisma } from "./lib/prisma";

const app = express();
const PORT = process.env.PORT ?? 3001;

// ── Global middleware ──────────────────────────────────────────────────────
app.set("trust proxy", 1);

// CORS — allow the configured frontend origin(s).
// CORS_ORIGIN can be:
//   • a single origin:  "https://heisenbug.vercel.app"
//   • comma-separated:  "https://heisenbug.vercel.app,https://heisenbug-git-main-xyz.vercel.app"
//   • "*" (dev only — do not use in production with credentials)
//
// On Render, set CORS_ORIGIN to the exact Vercel production URL.
// Locally, leave it unset (falls back to "*") or set "http://localhost:3000".
const rawCorsOrigin = process.env.CORS_ORIGIN ?? "*";
const allowedOrigins =
  rawCorsOrigin === "*"
    ? "*"
    : rawCorsOrigin.split(",").map((o) => o.trim()).filter(Boolean);

app.use(
  cors({
    origin: allowedOrigins,
    credentials: allowedOrigins !== "*",
  }),
);

// Fast liveness probe before any auth/middleware
app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "heisenbug-api", ts: new Date().toISOString() });
});

app.get("/", (_req, res) => {
  res.status(200).json({
    ok: true,
    service: "heisenbug-api",
    endpoints: {
      health: "/health",
      problems: "/api/problems",
    },
  });
});

// Preserve raw buffer for webhook signature verification
app.use(
  express.json({
    verify: (req: any, _res, buf) => {
      req.rawBody = buf;
    },
  })
);

// Clerk session authentication middleware
app.use(clerkMiddleware());

// ── Routes ─────────────────────────────────────────────────────────────────
app.use("/api/auth", authRouter);
app.use("/api/users", usersRouter);
app.use("/api/webhooks", webhooksRouter);
app.use("/api/problems", problemsRouter);
app.use("/api/sessions", sessionsRouter);
app.use("/api/sessions", runRouter);          // run + submit endpoints
app.use("/api/sessions", postmortemsRouter);  // postmortem + share endpoints
app.use("/api/sessions", mentorRouter);       // AI mentor endpoints
app.use("/api/sessions", aiCollabRouter);     // AI collaboration signals
app.use("/api/sessions", forkRouter);         // session fork (recruiter/admin)
app.use("/api/postmortems", postmortemsRouter); // public /api/postmortems/public/:token
app.use("/api/assessments", assessmentsRouter);
app.use("/api/invitations", invitationsRouter);
app.use("/api/admin", adminRouter);

// ── 404 handler ────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ ok: false, error: "Not found" });
});

// ── Global error handler ───────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  if (res.headersSent) {
    return _next(err);
  }

  // Handle Prisma known request errors safely
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2003") {
      res.status(409).json({
        ok: false,
        error: "Database foreign key constraint violation: a referenced record was not found.",
        code: "P2003",
        field: err.meta?.field_name,
      });
      return;
    }
    if (err.code === "P2002") {
      res.status(409).json({
        ok: false,
        error: "Database unique constraint violation.",
        code: "P2002",
        target: err.meta?.target,
      });
      return;
    }
    if (err.code === "P2025") {
      res.status(404).json({
        ok: false,
        error: "Requested database record was not found.",
        code: "P2025",
      });
      return;
    }
  }

  // Prefer statusCode (body-parser, http-errors) then status, then 500
  const status: number = err.statusCode ?? err.status ?? 500;
  const isClientError = status >= 400 && status < 500;

  // For client errors, expose the library's own message (e.g. "Unexpected token …");
  // for server errors, hide internals and log the full error.
  if (!isClientError) {
    console.error("[api] unhandled error:", err);
  }

  res.status(status).json({
    ok: false,
    error: isClientError ? (err.message ?? "Bad request") : "Internal server error",
  });
});

// ── Process-level error handling ───────────────────────────────────────────
// Prevent uncaught errors or rejected promises in async handlers from abruptly crashing the server process
process.on("unhandledRejection", (reason: any) => {
  console.error("[process] Unhandled Promise Rejection:", reason);
});

process.on("uncaughtException", (error: Error) => {
  console.error("[process] Uncaught Exception:", error);
});

// ── Start ──────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[api] listening on http://localhost:${PORT}`);
});

// Graceful shutdown
process.on("SIGTERM", async () => {
  await prisma.$disconnect();
  process.exit(0);
});

export default app;
