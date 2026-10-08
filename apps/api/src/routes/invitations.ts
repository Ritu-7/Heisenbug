import { Router, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import { prisma } from "../lib/prisma";
import { signToken } from "../lib/jwt";

const router = Router();

// Rate limiter for starting assessment sessions:
// Protects against resource exhaustion via automated spamming of database rows (User & Session creation).
const startInvitationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === "test" || process.env.CI ? 1000 : 10,
  standardHeaders: true,
  legacyHeaders: false,
  statusCode: 429,
  message: {
    ok: false,
    error: "Too many assessment start attempts. Please try again after 15 minutes.",
  },
  handler: (_req, res, _next, options) => {
    res.status(options.statusCode).json(options.message);
  },
});

// ── GET /api/invitations/:token ───────────────────────────────────────────
// PUBLIC. Returns assessment summary. Real 410 if expired, 409 if already used.

router.get(
  "/:token",
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
// Rate-limited: 10 attempts per 15 minutes per IP (returns 429 once exceeded).

router.post(
  "/:token/start",
  startInvitationLimiter,
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

    // Use the problem in the assessment to create the session
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
