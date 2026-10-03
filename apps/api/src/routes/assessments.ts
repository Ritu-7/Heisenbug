import { Router, Request, Response } from "express";
import { z } from "zod";
import { createId } from "@paralleldrive/cuid2";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";

const router = Router();

// ── Role guard helper ──────────────────────────────────────────────────────

function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: () => void): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ ok: false, error: "Forbidden: insufficient role" });
      return;
    }
    next();
  };
}

// ── Schemas ────────────────────────────────────────────────────────────────

const CreateAssessmentSchema = z.object({
  title: z.string().min(1),
  timeLimitMinutes: z.number().int().positive(),
  problemVersionId: z.string().min(1),
});

const InviteSchema = z.object({
  candidateEmail: z.string().email(),
});

// ── POST /api/assessments ─────────────────────────────────────────────────
// RECRUITER or ADMIN only. Creates Assessment + AssessmentProblem for problemVersionId.

router.post(
  "/",
  requireAuth,
  requireRole("RECRUITER", "ADMIN"),
  async (req: Request, res: Response): Promise<void> => {
    const parsed = CreateAssessmentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: parsed.error.flatten() });
      return;
    }

    const { title, timeLimitMinutes, problemVersionId } = parsed.data;

    // Verify problemVersionId exists before creating anything
    const version = await prisma.problemVersion.findUnique({
      where: { id: problemVersionId },
      select: { id: true },
    });
    if (!version) {
      res.status(400).json({ ok: false, error: "problemVersionId not found" });
      return;
    }

    const assessment = await prisma.assessment.create({
      data: {
        recruiterId: req.user!.sub,
        title,
        timeLimitMinutes,
        problems: {
          create: [{
            versionId: problemVersionId,
            orderIndex: 0,
          }],
        },
      },
      include: {
        problems: {
          include: { version: { include: { problem: true } } },
          orderBy: { orderIndex: "asc" },
        },
      },
    });

    res.status(201).json({ ok: true, data: assessment });
  },
);

// ── GET /api/assessments ──────────────────────────────────────────────────
// RECRUITER sees only their own. ADMIN sees all. Joined through AssessmentProblem.

router.get(
  "/",
  requireAuth,
  requireRole("RECRUITER", "ADMIN"),
  async (req: Request, res: Response): Promise<void> => {
    const whereClause =
      req.user!.role === "ADMIN" ? {} : { recruiterId: req.user!.sub };

    const assessments = await prisma.assessment.findMany({
      where: whereClause,
      include: {
        problems: {
          include: {
            version: {
              include: { problem: { select: { id: true, slug: true, title: true, difficulty: true } } },
            },
          },
          orderBy: { orderIndex: "asc" },
        },
        _count: { select: { invitations: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    res.json({ ok: true, data: assessments });
  },
);

// ── GET /api/assessments/:id ──────────────────────────────────────────────
// Full detail with invitations and derived status.

router.get(
  "/:id",
  requireAuth,
  requireRole("RECRUITER", "ADMIN"),
  async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    const assessment = await prisma.assessment.findUnique({
      where: { id: req.params.id },
      include: {
        problems: {
          include: {
            version: {
              include: { problem: true },
            },
          },
          orderBy: { orderIndex: "asc" },
        },
        invitations: {
          include: {
            session: {
              select: {
                id: true,
                status: true,
                _count: { select: { submissions: true } },
              },
            },
          },
          orderBy: { expiresAt: "asc" },
        },
      },
    });

    if (!assessment) {
      res.status(404).json({ ok: false, error: "Assessment not found" });
      return;
    }

    // Recruiters may only see their own assessments
    if (req.user!.role === "RECRUITER" && assessment.recruiterId !== req.user!.sub) {
      res.status(403).json({ ok: false, error: "Forbidden" });
      return;
    }

    // Derive invitation status from real session data
    const invitationsWithStatus = assessment.invitations.map((inv) => {
      let status: "INVITED" | "STARTED" | "SUBMITTED" = "INVITED";
      if (inv.sessionId) {
        const hasSubmissions = (inv.session?._count?.submissions ?? 0) > 0;
        status =
          inv.session?.status === "SUBMITTED" || hasSubmissions
            ? "SUBMITTED"
            : "STARTED";
      }
      const now = new Date();
      const expired = inv.expiresAt < now && status === "INVITED";
      return { ...inv, status: expired ? "EXPIRED" : status };
    });

    res.json({ ok: true, data: { ...assessment, invitations: invitationsWithStatus } });
  },
);

// ── POST /api/assessments/:id/invitations ─────────────────────────────────
// Creates a real Invitation with cuid token, expiresAt = now + 7 days.
// Returns the invitation link directly (TODO: deliver via real email here).

router.post(
  "/:id/invitations",
  requireAuth,
  requireRole("RECRUITER", "ADMIN"),
  async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    const parsed = InviteSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: parsed.error.flatten() });
      return;
    }

    const assessment = await prisma.assessment.findUnique({
      where: { id: req.params.id },
    });

    if (!assessment) {
      res.status(404).json({ ok: false, error: "Assessment not found" });
      return;
    }

    if (req.user!.role === "RECRUITER" && assessment.recruiterId !== req.user!.sub) {
      res.status(403).json({ ok: false, error: "Forbidden" });
      return;
    }

    const token = createId();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    const invitation = await prisma.invitation.create({
      data: {
        assessmentId: assessment.id,
        candidateEmail: parsed.data.candidateEmail,
        token,
        expiresAt,
      },
    });

    // TODO: Send real email to candidateEmail with inviteUrl below
    const appBase = process.env.APP_URL ?? "http://localhost:3000";
    const inviteUrl = `${appBase}/invite/${token}`;

    res.status(201).json({ ok: true, data: { invitation, inviteUrl } });
  },
);

export default router;
