import { Router, Request, Response } from "express";
import * as path from "path";
import * as fs from "fs";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { requireAuth, requireRole } from "../middleware/auth";

const router = Router();

const PROBLEMS_ROOT = path.resolve(__dirname, "../../../../packages/problems");

// ── Schema validation ──────────────────────────────────────────────────────

interface ForkBody {
  atTimestamp?: string; // ISO-8601 — if omitted, uses the last CODE_SAVE
}

// ── Helper: reconstruct code at a point in time ────────────────────────────

/**
 * Given a sessionId and a target timestamp, find the most recent CODE_SAVE
 * event at or before that timestamp and extract its stored code.
 * Falls back to problem's starter code if no CODE_SAVE exists before that point.
 */
async function reconstructCodeAtTimestamp(
  sessionId: string,
  atTimestamp: Date | null,
  slug: string,
): Promise<{ code: string; foundAt: string | null; source: "code_save" | "starter" }> {
  // Find the most recent CODE_SAVE at or before atTimestamp
  const whereClause = atTimestamp
    ? { sessionId, type: "CODE_SAVE", occurredAt: { lte: atTimestamp } }
    : { sessionId, type: "CODE_SAVE" };

  const latestSave = await prisma.sessionEvent.findFirst({
    where: whereClause,
    orderBy: { occurredAt: "desc" },
  });

  if (latestSave) {
    const p = latestSave.payloadJson as { code?: string };
    if (p?.code) {
      return {
        code: p.code,
        foundAt: latestSave.occurredAt.toISOString(),
        source: "code_save",
      };
    }
  }

  // Fall back to starter code from disk
  try {
    const metaPath = path.join(PROBLEMS_ROOT, slug, "meta.json");
    if (fs.existsSync(metaPath)) {
      const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
      const starterPath = path.join(PROBLEMS_ROOT, slug, "repo", meta.entryFile);
      if (fs.existsSync(starterPath)) {
        return {
          code: fs.readFileSync(starterPath, "utf-8"),
          foundAt: null,
          source: "starter",
        };
      }
    }
  } catch { /* ignore */ }

  return { code: "", foundAt: null, source: "starter" };
}

// ── Route ──────────────────────────────────────────────────────────────────

/**
 * POST /api/sessions/:id/fork
 * Body: { atTimestamp?: string } — ISO-8601 timestamp; defaults to latest CODE_SAVE
 *
 * Recruiter/Admin only — creates a new PRACTICE session starting from the
 * candidate's reconstructed code at the specified point in their timeline.
 *
 * The forked session is clearly labeled with metadata (forkOf, forkTimestamp,
 * forkCandidateEmail) in its initial CODE_SAVE event so it's never mistaken
 * for a fresh practice attempt.
 *
 * The fork does NOT count toward the original candidate's stats and creates
 * a completely independent session row.
 */
router.post(
  "/:id/fork",
  requireAuth,
  requireRole("RECRUITER", "ADMIN"),
  async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    const { id } = req.params;
    const userId = req.user!.sub;
    const { atTimestamp }: ForkBody = req.body ?? {};

    // Parse the timestamp
    let targetTime: Date | null = null;
    if (atTimestamp) {
      const parsed = new Date(atTimestamp);
      if (isNaN(parsed.getTime())) {
        res.status(400).json({ ok: false, error: "Invalid atTimestamp — must be ISO-8601" });
        return;
      }
      targetTime = parsed;
    }

    // Fetch the source session
    const sourceSession = await prisma.session.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, email: true, name: true } },
        version: {
          select: {
            id: true,
            problem: { select: { slug: true, title: true } },
          },
        },
        variant: { select: { id: true } },
      },
    });

    if (!sourceSession) {
      res.status(404).json({ ok: false, error: `Session '${id}' not found` });
      return;
    }

    // Recruiters can fork any practice session, or sessions linked to their own assessments
    if (req.user!.role === "RECRUITER" && sourceSession.mode === "ASSESSMENT") {
      const invitation = await prisma.invitation.findFirst({
        where: {
          sessionId: id,
          assessment: { recruiterId: userId },
        },
      });
      const isLinked = !!invitation;
      if (!isLinked) {
        res.status(403).json({
          ok: false,
          error: "Forbidden: you can only fork assessment sessions from your own assessments.",
        });
        return;
      }
    }

    const slug = sourceSession.version?.problem?.slug ?? "";
    const versionId = sourceSession.versionId;
    const variantId = sourceSession.variantId;
    const candidateEmail = sourceSession.user?.email ?? "unknown";

    // Reconstruct code at the specified timestamp
    const { code, foundAt, source } = await reconstructCodeAtTimestamp(
      id,
      targetTime,
      slug,
    );

    const resolvedTimestamp = foundAt ?? targetTime?.toISOString() ?? new Date().toISOString();

    // Create the forked session (PRACTICE mode, owned by the recruiter/admin user)
    const forkedSession = await prisma.session.create({
      data: {
        userId, // Fork is owned by the recruiter, not the candidate
        versionId,
        variantId,
        mode: "PRACTICE",
        status: "ACTIVE",
      },
    });

    // Seed the fork with the reconstructed code as a CODE_SAVE event
    // This is what the workspace will restore when the forked session is opened
    await prisma.sessionEvent.create({
      data: {
        sessionId: forkedSession.id,
        occurredAt: new Date(),
        type: "CODE_SAVE",
        payloadJson: {
          code,
          // Fork metadata — these fields mark this as a fork so it's never
          // mistaken for a fresh practice attempt
          isFork: true,
          forkOf: id,
          forkAtTimestamp: resolvedTimestamp,
          forkCandidateEmail: candidateEmail,
          forkCodeSource: source,
        } as unknown as Prisma.InputJsonObject,
      },
    });

    // Log a FORK_CREATED event on the forked session for traceability
    await prisma.sessionEvent.create({
      data: {
        sessionId: forkedSession.id,
        occurredAt: new Date(),
        type: "FORK_CREATED",
        payloadJson: {
          forkedFrom: id,
          forkedBy: userId,
          forkAtTimestamp: resolvedTimestamp,
          candidateEmail,
          codeSource: source,
          codeSaveFoundAt: foundAt,
        } as unknown as Prisma.InputJsonObject,
      },
    });

    // Also log a FORK_CREATED on the SOURCE session for audit trail
    await prisma.sessionEvent.create({
      data: {
        sessionId: id,
        occurredAt: new Date(),
        type: "FORK_CREATED",
        payloadJson: {
          forkedTo: forkedSession.id,
          forkedBy: userId,
          forkAtTimestamp: resolvedTimestamp,
        } as unknown as Prisma.InputJsonObject,
      },
    });

    const workspaceUrl = `/problems/${slug}?sessionId=${forkedSession.id}`;

    res.status(201).json({
      ok: true,
      data: {
        forkedSessionId: forkedSession.id,
        forkedFromSessionId: id,
        atTimestamp: resolvedTimestamp,
        codeSource: source,
        candidateEmail,
        workspaceUrl,
        forkBanner: `Forked from ${candidateEmail}'s session at ${new Date(resolvedTimestamp).toLocaleString()}`,
      },
    });
  },
);

export default router;
