import path from "path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(__dirname, "../.env") });
dotenv.config();

if (!process.env.CLERK_PUBLISHABLE_KEY && process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
  process.env.CLERK_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
}
if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_PUBLISHABLE_KEY) {
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = process.env.CLERK_PUBLISHABLE_KEY;
}

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
import postmortemsRouter from "./routes/postmortems";
import mentorRouter from "./routes/mentor";
import aiCollabRouter from "./routes/ai-collab";
import forkRouter from "./routes/fork";
import { prisma } from "./lib/prisma";

const app = express();
const PORT = process.env.PORT ?? 3001;

// ── Global middleware ──────────────────────────────────────────────────────
app.set("trust proxy", 1);
app.use(cors({ origin: process.env.CORS_ORIGIN ?? "*" }));

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
app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "heisenbug-api", ts: new Date().toISOString() });
});

app.use("/api/auth", authRouter);
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
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error("[api] unhandled error:", err);
  res.status(500).json({ ok: false, error: "Internal server error" });
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
