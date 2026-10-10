import { Router, Request, Response } from "express";
import * as path from "path";
import * as fs from "fs";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { requireAuth, requireRole } from "../middleware/auth";

const router = Router();

const PROBLEMS_ROOT = path.resolve(__dirname, "../../../../packages/problems");

// ── Types ──────────────────────────────────────────────────────────────────

export interface AICollabSignals {
  /** How many AI_MENTOR_MESSAGE pairs were used */
  mentorMessagePairs: number;
  /** Whether any AI mentor messages were used at all */
  usedAIMentor: boolean;

  /**
   * For each AI mentor message pair, did the candidate run tests
   * within 5 minutes of the mentor reply?
   * Null when no mentor was used.
   */
  verificationBehavior: "verified_before_submitting" | "submitted_without_verifying" | "no_ai_used";

  /**
   * Median time (ms) from AI_MENTOR_MESSAGE (mentor reply) to the next RUN_STARTED
   * or null if there was never a run after an AI message.
   */
  medianMsToNextRun: number | null;

  /**
   * How many mentor messages were used before the first successful RUN_COMPLETED
   * with passed=true
   */
  mentorMessagesBeforeFirstPassingRun: number | null;

  /**
   * Code-similarity check: for CODE_SAVE events that immediately follow an
   * AI_MENTOR_MESSAGE (within 2 minutes), what fraction of lines in the saved
   * code are new (not in the previous save)? Values near 0 = verbatim copy,
   * near 1 = heavily modified.
   *
   * Simple line-set diff: |new_lines - prev_lines| / |new_lines| is the
   * "originality" fraction. Not a plagiarism engine — just a signal.
   */
  postMentorCodeOriginalityFraction: number | null;

  /**
   * Derived label for display — purely advisory, NEVER affects verdict.
   */
  label: "verified_before_using" | "used_without_verification" | "adapted_ai_suggestions" | "no_ai_used";
  labelDetail: string;
}

// ── Signal derivation ──────────────────────────────────────────────────────

interface SessionEventRow {
  id: string;
  type: string;
  occurredAt: Date;
  payloadJson: unknown;
}

function computeAICollabSignals(events: SessionEventRow[]): AICollabSignals {
  const sorted = [...events].sort(
    (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime(),
  );

  const mentorReplyEvents = sorted.filter(
    (e) =>
      e.type === "AI_MENTOR_MESSAGE" &&
      (e.payloadJson as { role?: string })?.role === "mentor",
  );

  const runStartedEvents = sorted.filter((e) => e.type === "RUN_STARTED");
  const runCompletedEvents = sorted.filter((e) => e.type === "RUN_COMPLETED");
  const codeSaveEvents = sorted.filter((e) => e.type === "CODE_SAVE");
  const submitEvents = sorted.filter((e) => e.type === "SUBMIT");

  if (mentorReplyEvents.length === 0) {
    return {
      mentorMessagePairs: 0,
      usedAIMentor: false,
      verificationBehavior: "no_ai_used",
      medianMsToNextRun: null,
      mentorMessagesBeforeFirstPassingRun: null,
      postMentorCodeOriginalityFraction: null,
      label: "no_ai_used",
      labelDetail: "No AI mentor assistance used during this session.",
    };
  }

  // ── 1. Time from each mentor reply to next RUN_STARTED ────────────────────

  const msToNextRun: number[] = [];
  for (const mentorEvent of mentorReplyEvents) {
    const mentorTime = mentorEvent.occurredAt.getTime();
    // Find the next RUN_STARTED after this mentor reply
    const nextRun = runStartedEvents.find(
      (r) => r.occurredAt.getTime() > mentorTime,
    );
    if (nextRun) {
      msToNextRun.push(nextRun.occurredAt.getTime() - mentorTime);
    }
  }

  const medianMsToNextRun =
    msToNextRun.length > 0
      ? msToNextRun.sort((a, b) => a - b)[Math.floor(msToNextRun.length / 2)]
      : null;

  // ── 2. Did they run tests after any AI message, before submitting? ────────

  // For each mentor reply, check if there was a RUN_STARTED before the SUBMIT
  const finalSubmitTime =
    submitEvents.length > 0
      ? submitEvents[submitEvents.length - 1].occurredAt.getTime()
      : Infinity;

  const hasRunAfterMentorBeforeSubmit = mentorReplyEvents.some((mentorEvent) => {
    const mentorTime = mentorEvent.occurredAt.getTime();
    return runStartedEvents.some(
      (r) =>
        r.occurredAt.getTime() > mentorTime &&
        r.occurredAt.getTime() < finalSubmitTime,
    );
  });

  const verificationBehavior = hasRunAfterMentorBeforeSubmit
    ? "verified_before_submitting"
    : "submitted_without_verifying";

  // ── 3. Mentor messages before first passing run ───────────────────────────

  const firstPassingRun = runCompletedEvents.find((e) => {
    const p = e.payloadJson as { passed?: boolean };
    return p?.passed === true;
  });

  const mentorMessagesBeforeFirstPassingRun = firstPassingRun
    ? mentorReplyEvents.filter(
        (m) => m.occurredAt.getTime() < firstPassingRun.occurredAt.getTime(),
      ).length
    : null;

  // ── 4. Code originality after mentor messages ─────────────────────────────
  // For CODE_SAVE events within 2 min of a mentor reply, compare to prior CODE_SAVE

  const TWO_MIN_MS = 2 * 60_000;
  const originalityFractions: number[] = [];

  for (const mentorEvent of mentorReplyEvents) {
    const mentorTime = mentorEvent.occurredAt.getTime();
    // Find CODE_SAVE events within 2 minutes after this mentor reply
    const postMentorSaves = codeSaveEvents.filter(
      (cs) =>
        cs.occurredAt.getTime() > mentorTime &&
        cs.occurredAt.getTime() - mentorTime <= TWO_MIN_MS,
    );

    for (const save of postMentorSaves) {
      // Find the CODE_SAVE immediately before this one
      const saveIdx = codeSaveEvents.indexOf(save);
      if (saveIdx <= 0) continue;
      const prevSave = codeSaveEvents[saveIdx - 1];

      const newCode = (save.payloadJson as { code?: string })?.code ?? "";
      const prevCode = (prevSave.payloadJson as { code?: string })?.code ?? "";

      if (!newCode) continue;

      const newLines = new Set(newCode.split("\n").map((l) => l.trim()).filter(Boolean));
      const prevLines = new Set(prevCode.split("\n").map((l) => l.trim()).filter(Boolean));

      // Count lines that are NEW (not in prevLines)
      const addedLines = [...newLines].filter((l) => !prevLines.has(l)).length;
      const totalNewLines = newLines.size;

      if (totalNewLines > 0) {
        // Originality = fraction of new content that's genuinely new vs verbatim copied
        originalityFractions.push(addedLines / totalNewLines);
      }
    }
  }

  const postMentorCodeOriginalityFraction =
    originalityFractions.length > 0
      ? originalityFractions.reduce((s, f) => s + f, 0) / originalityFractions.length
      : null;

  // ── 5. Derive label ───────────────────────────────────────────────────────

  let label: AICollabSignals["label"];
  let labelDetail: string;

  if (!hasRunAfterMentorBeforeSubmit && submitEvents.length > 0) {
    label = "used_without_verification";
    labelDetail = `Used AI mentor ${mentorReplyEvents.length} time(s) but submitted without running tests afterward.`;
  } else if (
    postMentorCodeOriginalityFraction !== null &&
    postMentorCodeOriginalityFraction < 0.2
  ) {
    // Mostly verbatim copy but did verify
    label = "verified_before_using";
    labelDetail = `Used AI mentor and ran tests before submitting. Post-mentor code was ${Math.round((postMentorCodeOriginalityFraction ?? 0) * 100)}% original (low originality — may have used suggestions verbatim).`;
  } else if (hasRunAfterMentorBeforeSubmit) {
    label =
      postMentorCodeOriginalityFraction !== null && postMentorCodeOriginalityFraction > 0.5
        ? "adapted_ai_suggestions"
        : "verified_before_using";
    const origPct = postMentorCodeOriginalityFraction !== null
      ? ` Post-mentor code was ${Math.round(postMentorCodeOriginalityFraction * 100)}% original.`
      : "";
    labelDetail = `Used AI mentor ${mentorReplyEvents.length} time(s) and ran tests before submitting.${origPct}`;
  } else {
    label = "verified_before_using";
    labelDetail = `Used AI mentor ${mentorReplyEvents.length} time(s). No submit recorded yet.`;
  }

  return {
    mentorMessagePairs: mentorReplyEvents.length,
    usedAIMentor: true,
    verificationBehavior,
    medianMsToNextRun,
    mentorMessagesBeforeFirstPassingRun,
    postMentorCodeOriginalityFraction,
    label,
    labelDetail,
  };
}

// ── Routes ─────────────────────────────────────────────────────────────────

/**
 * GET /api/sessions/:id/ai-collab
 * Returns AI collaboration signals derived from real SessionEvent rows.
 *
 * IMPORTANT: These signals are PURELY ADVISORY and NEVER affect the
 * deterministic pass/fail verdict from Run/Submit. The verdict is computed
 * by the test runner in isolation from all AI signals.
 *
 * Auth: same ownership rules as GET /api/sessions/:id
 */
router.get(
  "/:id/ai-collab",
  requireAuth,
  async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    const { id } = req.params;
    const userId = req.user!.sub;

    const session = await prisma.session.findUnique({
      where: { id },
      select: {
        userId: true,
        invitation: {
          select: { assessment: { select: { recruiterId: true } } },
        },
      },
    });

    if (!session) {
      res.status(404).json({ ok: false, error: `Session '${id}' not found` });
      return;
    }

    const isOwner = session.userId === userId;
    const isAdmin = req.user!.role === "ADMIN";
    const isAssignedRecruiter =
      req.user!.role === "RECRUITER" &&
      session.invitation?.assessment.recruiterId === userId;

    if (!isOwner && !isAdmin && !isAssignedRecruiter) {
      res.status(403).json({ ok: false, error: "Forbidden" });
      return;
    }

    const events = await prisma.sessionEvent.findMany({
      where: { sessionId: id },
      orderBy: { occurredAt: "asc" },
    });

    const signals = computeAICollabSignals(events);

    res.json({
      ok: true,
      data: {
        sessionId: id,
        signals,
        // Explicitly state that this does NOT affect verdict
        verdictIsolation: "AI collaboration signals are ADVISORY ONLY. The pass/fail verdict from Run/Submit is computed entirely from test results and is unchanged regardless of AI usage.",
      },
    });
  },
);

export { computeAICollabSignals };
export default router;
