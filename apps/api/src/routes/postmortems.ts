import { Router, Request, Response } from "express";
import * as path from "path";
import * as fs from "fs";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";

const router = Router();

// ── Types ──────────────────────────────────────────────────────────────────

interface HintPayload {
  hintIndex: number;
  penalty: number;
  description?: string;
}

interface RunCompletedPayload {
  passed: boolean;
  score: number;
  checks: Array<{ id: string; weight: number; passed: boolean; message?: string }>;
  durationMs: number;
}

interface SubmitPayload {
  passed: boolean;
  score: number;
  checks: Array<{ id: string; weight: number; passed: boolean; message?: string }>;
  durationMs: number;
}

export interface PostmortemDoc {
  sessionId: string;
  generatedAt: string;

  // Problem identity
  problem: {
    title: string;
    slug: string;
    track: string;
    difficulty: string;
    estMinutes: number;
    skills: string[];
    ticketSummary: string;   // first paragraph of descriptionMd
    editorial: string;       // editorialMd full content
  };

  // Candidate identity
  candidate: {
    name: string;
    email: string;
  };

  // Timeline derived from real SessionEvent rows
  timeline: {
    sessionStarted: string;          // session.createdAt
    firstEdit: string | null;        // first CODE_SAVE occurredAt
    firstRun: string | null;         // first RUN_STARTED occurredAt
    finalSubmit: string | null;      // SUBMIT occurredAt
    totalDurationMs: number | null;  // firstEdit → finalSubmit
    wallClockMinutes: number | null; // session.createdAt → finalSubmit
  };

  // Attempt stats derived from real events
  attempts: {
    runCount: number;             // count of RUN_STARTED events
    passingRunBeforeSubmit: boolean; // any RUN_COMPLETED with passed=true before submit
    hintsUsed: Array<{
      hintIndex: number;
      penalty: number;
      description: string;
      at: string;
    }>;
    totalPenalty: number;
  };

  // Final verdict from actual Submission row
  verdict: {
    passed: boolean;
    score: number;
    checks: Array<{
      id: string;
      weight: number;
      passed: boolean;
      message?: string;
    }>;
    submittedAt: string;
    diffText: string;            // real unified diff from submission
    executionMode: "DOCKER" | "NATIVE_UNISOLATED";
  };

  // Narrative fields (derived, not LLM)
  narrative: {
    whatBroke: string;           // derived from failed checks
    rootCauseHint: string;       // first paragraph of editorial
    howLongItTook: string;       // human-readable duration string
    whatWasTried: string;        // based on run count + hints
  };

  // Share info (if share exists)
  shareToken: string | null;
}

// ── Helpers ────────────────────────────────────────────────────────────────

const PROBLEMS_ROOT = path.resolve(__dirname, "../../../../packages/problems");

/** Extract first non-empty paragraph from markdown */
function firstParagraph(md: string): string {
  if (!md) return "";
  const lines = md.split("\n");
  const paras: string[] = [];
  let current: string[] = [];

  for (const line of lines) {
    if (line.startsWith("#")) continue; // skip headings
    if (line.trim() === "") {
      if (current.length > 0) {
        paras.push(current.join(" ").trim());
        current = [];
        if (paras.length >= 1) break;
      }
    } else {
      current.push(line.trim());
    }
  }
  if (current.length > 0 && paras.length === 0) {
    paras.push(current.join(" ").trim());
  }

  return paras[0] ?? "";
}

/** Human-readable duration from ms */
function humanizeDuration(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  if (minutes < 60) return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

/** Derive "what broke" narrative from failed checks */
function deriveWhatBroke(checks: Array<{ id: string; passed: boolean; message?: string }>): string {
  const failed = checks.filter((c) => !c.passed);
  if (failed.length === 0) return "All checks passed — no regressions detected.";
  const hiddenFailed = failed.filter((c) => c.id.startsWith("H"));
  const visibleFailed = failed.filter((c) => c.id.startsWith("V"));

  const parts: string[] = [];
  if (visibleFailed.length > 0) {
    parts.push(`${visibleFailed.length} visible check${visibleFailed.length > 1 ? "s" : ""} failed (${visibleFailed.map((c) => c.id).join(", ")})`);
  }
  if (hiddenFailed.length > 0) {
    parts.push(`${hiddenFailed.length} hidden check${hiddenFailed.length > 1 ? "s" : ""} failed (${hiddenFailed.map((c) => c.id).join(", ")})`);
  }

  const firstMessage = failed.find((c) => c.message)?.message;
  const suffix = firstMessage ? `. First failure: "${firstMessage}"` : "";
  return parts.join(" and ") + suffix + ".";
}

/** Derive "what was tried" narrative */
function deriveWhatWasTried(runCount: number, hintsUsed: PostmortemDoc["attempts"]["hintsUsed"]): string {
  const parts: string[] = [];
  if (runCount === 0) {
    parts.push("No test runs before final submission.");
  } else if (runCount === 1) {
    parts.push("Ran the visible test suite once before submitting.");
  } else {
    parts.push(`Ran the visible test suite ${runCount} time${runCount > 1 ? "s" : ""} before submitting.`);
  }
  if (hintsUsed.length === 0) {
    parts.push("No hints were used.");
  } else {
    const penaltyStr = hintsUsed.reduce((sum, h) => sum + h.penalty, 0);
    parts.push(`Used ${hintsUsed.length} hint${hintsUsed.length > 1 ? "s" : ""} (total penalty: -${penaltyStr} pts).`);
  }
  return parts.join(" ");
}

// ── Access check helper (same ownership rules as GET /api/sessions/:id) ────

async function checkSessionAccess(
  sessionId: string,
  userId: string,
  userRole: string,
): Promise<{
  allowed: boolean;
  session: Awaited<ReturnType<typeof fetchFullSession>> | null;
}> {
  const session = await fetchFullSession(sessionId);
  if (!session) return { allowed: false, session: null };

  const isOwner = session.userId === userId;
  const isAdmin = userRole === "ADMIN";
  const isAssignedRecruiter =
    userRole === "RECRUITER" &&
    session.invitation?.assessment.recruiterId === userId;

  return {
    allowed: isOwner || isAdmin || isAssignedRecruiter,
    session,
  };
}

async function fetchFullSession(sessionId: string) {
  return prisma.session.findUnique({
    where: { id: sessionId },
    include: {
      user: { select: { id: true, email: true, name: true } },
      version: {
        select: {
          id: true,
          version: true,
          descriptionMd: true,
          editorialMd: true,
          problem: {
            select: {
              id: true,
              slug: true,
              title: true,
              track: true,
              difficulty: true,
              estMinutes: true,
              skills: true,
            },
          },
        },
      },
      events: {
        orderBy: { occurredAt: "asc" },
      },
      submissions: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
      hintUses: {
        orderBy: { createdAt: "asc" },
      },
      invitation: {
        include: {
          assessment: { select: { id: true, title: true, recruiterId: true } },
        },
      },
      postmortemShare: true,
    },
  });
}

// ── Build postmortem doc from a fully-fetched session ──────────────────────

function buildPostmortemDoc(session: NonNullable<Awaited<ReturnType<typeof fetchFullSession>>>): PostmortemDoc | null {
  const events = session.events;
  const latestSubmission = session.submissions[0];

  if (!latestSubmission) return null;

  const verdictJson = latestSubmission.verdictJson as {
    passed?: boolean;
    score?: number;
    checks?: Array<{ id: string; weight: number; passed: boolean; message?: string }>;
  };
  if (!verdictJson?.passed) return null; // only for passed sessions

  // ── Timeline ──────────────────────────────────────────────────────────────

  const codeSaveEvents = events.filter((e) => e.type === "CODE_SAVE");
  const runStartedEvents = events.filter((e) => e.type === "RUN_STARTED");
  const submitEvents = events.filter((e) => e.type === "SUBMIT");

  const firstEdit = codeSaveEvents[0]?.occurredAt?.toISOString() ?? null;
  const firstRun = runStartedEvents[0]?.occurredAt?.toISOString() ?? null;
  const finalSubmitAt = submitEvents[submitEvents.length - 1]?.occurredAt?.toISOString()
    ?? latestSubmission.createdAt.toISOString();

  const sessionStarted = session.createdAt.toISOString();
  const firstEditMs = firstEdit ? new Date(firstEdit).getTime() : null;
  const finalSubmitMs = new Date(finalSubmitAt).getTime();
  const sessionStartMs = new Date(sessionStarted).getTime();

  const totalDurationMs = firstEditMs ? finalSubmitMs - firstEditMs : null;
  const wallClockMs = finalSubmitMs - sessionStartMs;

  // ── Hints ──────────────────────────────────────────────────────────────────

  const hintRevealEvents = events.filter((e) => e.type === "HINT_REVEAL");
  const hintsUsed = hintRevealEvents.map((e) => {
    const p = e.payloadJson as unknown as HintPayload;
    return {
      hintIndex: p.hintIndex ?? 0,
      penalty: p.penalty ?? 0,
      description: p.description ?? `Hint ${p.hintIndex}`,
      at: e.occurredAt.toISOString(),
    };
  });
  const totalPenalty = hintsUsed.reduce((sum, h) => sum + h.penalty, 0);

  // ── Run attempts ───────────────────────────────────────────────────────────

  const runCompletedEvents = events.filter((e) => e.type === "RUN_COMPLETED");
  const passingRunBeforeSubmit = runCompletedEvents.some((e) => {
    const p = e.payloadJson as unknown as RunCompletedPayload;
    return p?.passed === true;
  });

  // ── Problem fields ─────────────────────────────────────────────────────────

  const problem = session.version?.problem;
  const descriptionMd = session.version?.descriptionMd ?? "";
  const editorialMd = session.version?.editorialMd ?? "";
  const ticketSummary = firstParagraph(descriptionMd);
  const rootCauseHint = firstParagraph(editorialMd);

  // ── Verdict ────────────────────────────────────────────────────────────────

  const checks = verdictJson.checks ?? [];
  const score = verdictJson.score ?? latestSubmission.score;

  // ── Narrative ──────────────────────────────────────────────────────────────

  const whatBroke = deriveWhatBroke(checks);
  const howLongItTook = totalDurationMs
    ? `${humanizeDuration(totalDurationMs)} active editing time`
    : `${humanizeDuration(wallClockMs)} total wall-clock time`;
  const whatWasTried = deriveWhatWasTried(runStartedEvents.length, hintsUsed);

  return {
    sessionId: session.id,
    generatedAt: new Date().toISOString(),

    problem: {
      title: problem?.title ?? "Unknown Problem",
      slug: problem?.slug ?? "",
      track: problem?.track ?? "",
      difficulty: problem?.difficulty ?? "",
      estMinutes: problem?.estMinutes ?? 0,
      skills: problem?.skills ?? [],
      ticketSummary,
      editorial: editorialMd,
    },

    candidate: {
      name: session.user?.name ?? "",
      email: session.user?.email ?? "",
    },

    timeline: {
      sessionStarted,
      firstEdit,
      firstRun,
      finalSubmit: finalSubmitAt,
      totalDurationMs,
      wallClockMinutes: Math.round(wallClockMs / 60_000),
    },

    attempts: {
      runCount: runStartedEvents.length,
      passingRunBeforeSubmit,
      hintsUsed,
      totalPenalty,
    },

    verdict: {
      passed: verdictJson.passed ?? false,
      score,
      checks,
      submittedAt: latestSubmission.createdAt.toISOString(),
      diffText: latestSubmission.diffText,
      executionMode: (latestSubmission as any).executionMode ?? "DOCKER",
    },

    narrative: {
      whatBroke,
      rootCauseHint,
      howLongItTook,
      whatWasTried,
    },

    shareToken: session.postmortemShare?.token ?? null,
  };
}

// ── Routes ─────────────────────────────────────────────────────────────────

/**
 * GET /api/sessions/:id/postmortem
 * Build and return a structured postmortem document from real SessionEvent rows.
 * Only available for sessions where the final submission has passed: true.
 * Auth: same ownership rules as GET /api/sessions/:id
 */
router.get("/:id/postmortem", requireAuth, async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  const { id } = req.params;
  const userId = req.user!.sub;
  const userRole = req.user!.role;

  const { allowed, session } = await checkSessionAccess(id, userId, userRole);

  if (!session) {
    res.status(404).json({ ok: false, error: `Session '${id}' not found` });
    return;
  }
  if (!allowed) {
    res.status(403).json({ ok: false, error: "Forbidden" });
    return;
  }

  const doc = buildPostmortemDoc(session);

  if (!doc) {
    res.status(422).json({
      ok: false,
      error: "Postmortem is only available for sessions with a passing submission.",
    });
    return;
  }

  res.json({ ok: true, data: doc });
});

/**
 * POST /api/sessions/:id/postmortem/share
 * Generate (or return existing) a public share token for this postmortem.
 * Auth: same ownership rules — only the candidate or admins may generate a share link.
 */
router.post("/:id/postmortem/share", requireAuth, async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  const { id } = req.params;
  const userId = req.user!.sub;
  const userRole = req.user!.role;

  const { allowed, session } = await checkSessionAccess(id, userId, userRole);

  if (!session) {
    res.status(404).json({ ok: false, error: `Session '${id}' not found` });
    return;
  }
  if (!allowed) {
    res.status(403).json({ ok: false, error: "Forbidden" });
    return;
  }

  // Verify the session has a passing submission
  const doc = buildPostmortemDoc(session);
  if (!doc) {
    res.status(422).json({
      ok: false,
      error: "Postmortem is only available for sessions with a passing submission.",
    });
    return;
  }

  // Upsert share (idempotent — repeated calls return the same token)
  const share = await prisma.postmortemShare.upsert({
    where: { sessionId: id },
    update: {},
    create: { sessionId: id },
  });

  const shareUrl = `${process.env.CORS_ORIGIN ?? "http://localhost:3000"}/postmortems/${share.token}`;

  res.status(201).json({
    ok: true,
    data: {
      token: share.token,
      shareUrl,
      sessionId: id,
    },
  });
});

/**
 * GET /api/postmortems/:token
 * Public (no auth) — returns the postmortem doc for the given share token.
 */
router.get("/public/:token", async (req: Request<{ token: string }>, res: Response): Promise<void> => {
  const { token } = req.params;

  const share = await prisma.postmortemShare.findUnique({
    where: { token },
    include: { session: { select: { id: true } } },
  });

  if (!share) {
    res.status(404).json({ ok: false, error: "Postmortem not found or link has expired." });
    return;
  }

  const session = await fetchFullSession(share.session.id);
  if (!session) {
    res.status(404).json({ ok: false, error: "Session not found." });
    return;
  }

  const doc = buildPostmortemDoc(session);
  if (!doc) {
    res.status(404).json({ ok: false, error: "No passing submission found." });
    return;
  }

  res.json({ ok: true, data: doc });
});

export default router;
