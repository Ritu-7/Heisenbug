import { Router, Request, Response } from "express";
import { z } from "zod";
import { createId } from "@paralleldrive/cuid2";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";
import { signToken } from "../lib/jwt";

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
  problemVersionIds: z.array(z.string()).min(1),
});

const InviteSchema = z.object({
  candidateEmail: z.string().email(),
});

// ── POST /api/assessments ─────────────────────────────────────────────────
// RECRUITER or ADMIN only. Creates Assessment + one AssessmentProblem per versionId.

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

    const { title, timeLimitMinutes, problemVersionIds } = parsed.data;

    // Verify all versionIds exist before creating anything
    const versions = await prisma.problemVersion.findMany({
      where: { id: { in: problemVersionIds } },
      select: { id: true },
    });
    if (versions.length !== problemVersionIds.length) {
      res.status(400).json({ ok: false, error: "One or more problemVersionIds not found" });
      return;
    }

    const assessment = await prisma.assessment.create({
      data: {
        recruiterId: req.user!.sub,
        title,
        timeLimitMinutes,
        problems: {
          create: problemVersionIds.map((versionId, index) => ({
            versionId,
            orderIndex: index,
          })),
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

// ── GET /api/invitations/:token ───────────────────────────────────────────
// PUBLIC. Returns assessment summary. Real 410 if expired, 409 if already used.

router.get(
  "/invitations/:token",
  async (req: Request<{ token: string }>, res: Response): Promise<void> => {
    const invitation = await prisma.invitation.findUnique({
      where: { token: req.params.token },
      include: {
        assessment: {
          include: {
            problems: { select: { id: true } },
          },
        },
      },
    });

    if (!invitation) {
      res.status(404).json({ ok: false, error: "Invitation not found" });
      return;
    }

    if (invitation.sessionId) {
      res.status(409).json({ ok: false, error: "This invitation has already been used" });
      return;
    }

    if (invitation.expiresAt < new Date()) {
      res.status(410).json({ ok: false, error: "This invitation has expired" });
      return;
    }

    res.json({
      ok: true,
      data: {
        token: invitation.token,
        candidateEmail: invitation.candidateEmail,
        expiresAt: invitation.expiresAt,
        assessment: {
          id: invitation.assessment.id,
          title: invitation.assessment.title,
          timeLimitMinutes: invitation.assessment.timeLimitMinutes,
          problemCount: invitation.assessment.problems.length,
        },
      },
    });
  },
);

// ── POST /api/invitations/:token/start ────────────────────────────────────
// PUBLIC. Validates token. Creates (or reuses) CANDIDATE User, creates Session
// in ASSESSMENT mode with deadline, links invitation.sessionId.
// Returns a session-scoped JWT so subsequent Run/Submit calls are authenticated.

router.post(
  "/invitations/:token/start",
  async (req: Request<{ token: string }>, res: Response): Promise<void> => {
    const invitation = await prisma.invitation.findUnique({
      where: { token: req.params.token },
      include: {
        assessment: {
          include: {
            problems: {
              include: {
                version: {
                  include: { variants: { take: 1 } },
                },
              },
              orderBy: { orderIndex: "asc" },
            },
          },
        },
      },
    });

    if (!invitation) {
      res.status(404).json({ ok: false, error: "Invitation not found" });
      return;
    }

    if (invitation.sessionId) {
      res.status(409).json({ ok: false, error: "This invitation has already been used" });
      return;
    }

    if (invitation.expiresAt < new Date()) {
      res.status(410).json({ ok: false, error: "This invitation has expired" });
      return;
    }

    // Create or reuse a CANDIDATE user (passwordless — no password hash)
    const user = await prisma.user.upsert({
      where: { email: invitation.candidateEmail },
      update: {},
      create: {
        email: invitation.candidateEmail,
        name: invitation.candidateEmail.split("@")[0],
        role: "CANDIDATE",
      },
    });

    // Use the first problem in the assessment to create the session
    const firstProblem = invitation.assessment.problems[0];
    if (!firstProblem) {
      res.status(500).json({ ok: false, error: "Assessment has no problems" });
      return;
    }

    const variant = firstProblem.version.variants[0];
    if (!variant) {
      res.status(500).json({ ok: false, error: "Problem version has no variants" });
      return;
    }

    const deadline = new Date(Date.now() + invitation.assessment.timeLimitMinutes * 60 * 1000);

    const session = await prisma.session.create({
      data: {
        userId: user.id,
        versionId: firstProblem.versionId,
        variantId: variant.id,
        mode: "ASSESSMENT",
        deadline,
      },
      include: {
        version: {
          include: {
            problem: { select: { id: true, slug: true, title: true } },
          },
        },
      },
    });

    // Link the invitation to this session
    await prisma.invitation.update({
      where: { id: invitation.id },
      data: { sessionId: session.id },
    });

    // Issue a session-scoped JWT so the candidate can call Run/Submit
    const token = signToken({ sub: user.id, email: user.email, role: user.role });

    res.status(201).json({
      ok: true,
      data: {
        token,
        session,
        assessment: {
          id: invitation.assessment.id,
          title: invitation.assessment.title,
          timeLimitMinutes: invitation.assessment.timeLimitMinutes,
          problemCount: invitation.assessment.problems.length,
        },
      },
    });
  },
);

export default router;
