import "dotenv/config";
import express, { Request, Response, NextFunction } from "express";
import cors from "cors";

import authRouter from "./routes/auth";
import problemsRouter from "./routes/problems";
import sessionsRouter from "./routes/sessions";
import runRouter from "./routes/run";
import { prisma } from "./lib/prisma";

const app = express();
const PORT = process.env.PORT ?? 3001;

// ── Global middleware ──────────────────────────────────────────────────────
app.use(cors({ origin: process.env.CORS_ORIGIN ?? "*" }));
app.use(express.json());

// ── Routes ─────────────────────────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "heisenbug-api", ts: new Date().toISOString() });
});

app.use("/api/auth", authRouter);
app.use("/api/problems", problemsRouter);
app.use("/api/sessions", sessionsRouter);
app.use("/api/sessions", runRouter); // run + submit endpoints

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
