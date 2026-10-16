import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";

const router = Router();

// ── Schema validation ──────────────────────────────────────────────────────

const CreateSessionSchema = z.object({
  versionId: z.string().min(1),
  variantId: z.string().min(1).optional(),
  mode: z.enum(["PRACTICE", "ASSESSMENT"]),
  deadline: z.string().datetime().optional(), // ISO-8601
});

const CreateEventSchema = z.object({
  occurredAt: z.string().datetime(),
  type: z.string().min(1),
  payloadJson: z.record(z.unknown()).default({}),
});

// ── Routes ─────────────────────────────────────────────────────────────────

/**
 * GET /api/sessions
 * Returns all sessions for the authenticated user, ordered by createdAt desc.
 * Includes version with problem, variant, and latest submission.
 */
router.get("/", requireAuth, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user!.sub;

    const sessions = await prisma.session.findMany({
      where: req.user!.role === "ADMIN" ? {} : { userId },
      orderBy: { createdAt: "desc" },
      include: {
        version: {
          select: {
            id: true,
            version: true,
            status: true,
            createdAt: true,
            problem: {
              select: { id: true, slug: true, title: true, track: true, difficulty: true, estMinutes: true, skills: true, stack: true },
            },
          },
        },
        variant: true,
        submissions: {
          orderBy: { createdAt: "desc" },
        },
      },
    });

    res.json({ ok: true, data: sessions });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/sessions
 * Body: { versionId, variantId?, mode, deadline? }
 * Auth: required — userId comes from the JWT/Clerk session
 *
 * If variantId is omitted, picks the first variant for the given versionId.
 */
router.post("/", requireAuth, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = CreateSessionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: "Invalid request body", fieldErrors: parsed.error.flatten().fieldErrors });
      return;
    }

    const { versionId, variantId, mode, deadline } = parsed.data;
    const userId = req.user!.sub;

    // Resolve variantId — use provided, or pick the first variant for this version
    let resolvedVariantId = variantId;
    if (!resolvedVariantId) {
      const defaultVariant = await prisma.variant.findFirst({
        where: { versionId },
        orderBy: { id: "asc" },
        select: { id: true },
      });
      if (!defaultVariant) {
        res.status(422).json({ ok: false, error: `No variant found for versionId '${versionId}'` });
        return;
      }
      resolvedVariantId = defaultVariant.id;
    }

    // Verify the version exists
    const version = await prisma.problemVersion.findUnique({
      where: { id: versionId },
      select: { id: true, status: true },
    });
    if (!version) {
      res.status(404).json({ ok: false, error: `ProblemVersion '${versionId}' not found` });
      return;
    }

    // ── Verify and guarantee user exists in Postgres before inserting session ──
    // Resolves cases where:
    //  • User just signed up and Clerk webhook is delayed or not delivered
    //  • Database was reset/migrated on a different instance than auth provider
    //  • User exists under an alternative ID matching the verified email
    let dbUser = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!dbUser && req.user?.email) {
      dbUser = await prisma.user.findUnique({
        where: { email: req.user.email },
      });
    }

    if (!dbUser) {
      try {
        dbUser = await prisma.user.create({
          data: {
            id: userId,
            email: req.user?.email || `${userId}@placeholder.heisenbug.dev`,
            name: req.user?.email ? req.user.email.split("@")[0] : "Candidate",
            role: (req.user?.role as any) || "CANDIDATE",
          },
        });
      } catch (userCreateErr) {
        // Handle race condition or duplicate email concurrently created
        dbUser = await prisma.user.findFirst({
          where: { OR: [{ id: userId }, ...(req.user?.email ? [{ email: req.user.email }] : [])] },
        });
      }
    }

    if (!dbUser) {
      res.status(401).json({
        ok: false,
        error: "Authenticated user could not be found or provisioned in the database. Please re-authenticate.",
      });
      return;
    }

    const session = await prisma.session.create({
      data: {
        userId: dbUser.id,
        versionId,
        variantId: resolvedVariantId,
        mode,
        status: "ACTIVE",
        deadline: deadline ? new Date(deadline) : null,
      },
    });

    res.status(201).json({ ok: true, data: session });
  } catch (err: any) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === "P2003") {
        res.status(409).json({
          ok: false,
          error: "Foreign key constraint violation: referenced user or problem version does not exist.",
          details: err.meta,
        });
        return;
      }
      if (err.code === "P2002") {
        res.status(409).json({
          ok: false,
          error: "A unique constraint violation occurred while creating session.",
          details: err.meta,
        });
        return;
      }
    }
    next(err);
  }
});

/**
 * GET /api/sessions/:id
 * Returns the session row joined with its ProblemVersion and Variant.
 * Auth: required — only the owning user may view their own session.
 */
router.get("/:id", requireAuth, async (req: Request<{ id: string }>, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const userId = req.user!.sub;

    const session = await prisma.session.findUnique({
      where: { id },
      include: {
        user: {
          select: { id: true, email: true, name: true },
        },
        version: {
          select: {
            id: true,
            version: true,
            status: true,
            descriptionMd: true,
            editorialMd: true,
            solutionMd: true,
            createdAt: true,
            problem: {
              select: { id: true, slug: true, title: true, track: true, difficulty: true, estMinutes: true, skills: true, stack: true },
            },
          },
        },
        variant: true,
        submissions: {
          orderBy: { createdAt: "desc" },
        },
        invitation: {
          include: {
            assessment: { select: { id: true, title: true, recruiterId: true, timeLimitMinutes: true } },
          },
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

    res.json({ ok: true, data: session });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/sessions/:id/submissions
 * Returns all submissions for this session, ordered by createdAt desc.
 * Empty array (not 404) when none exist yet.
 */
router.get("/:id/submissions", requireAuth, async (req: Request<{ id: string }>, res: Response, next: NextFunction): Promise<void> => {
  try {
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

    const submissions = await prisma.submission.findMany({
      where: { sessionId: id },
      orderBy: { createdAt: "desc" },
    });

    res.json({ ok: true, data: submissions });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/sessions/:id/events
 * Returns all events for this session, ordered by occurredAt asc.
 * Used by the workspace to restore saved code and replay session history.
 */
router.get("/:id/events", requireAuth, async (req: Request<{ id: string }>, res: Response, next: NextFunction): Promise<void> => {
  try {
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

    res.json({ ok: true, data: events });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/sessions/:id/events
 * Body: { occurredAt, type, payloadJson? }
 * Inserts a real SessionEvent row and returns it.
 */
router.post("/:id/events", requireAuth, async (req: Request<{ id: string }>, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const userId = req.user!.sub;

    const parsed = CreateEventSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: "Invalid request body", fieldErrors: parsed.error.flatten().fieldErrors });
      return;
    }

    const session = await prisma.session.findUnique({
      where: { id },
      select: { userId: true },
    });
    if (!session) {
      res.status(404).json({ ok: false, error: `Session '${id}' not found` });
      return;
    }
    if (session.userId !== userId && req.user!.role !== "ADMIN") {
      res.status(403).json({ ok: false, error: "Forbidden" });
      return;
    }

    const { occurredAt, type, payloadJson } = parsed.data;

    const event = await prisma.sessionEvent.create({
      data: {
        sessionId: id,
        occurredAt: new Date(occurredAt),
        type,
        payloadJson: payloadJson as Prisma.InputJsonObject,
      },
    });

    res.status(201).json({ ok: true, data: event });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/sessions/:id/hints
 * Body: { hintIndex?: number, penalty?: number, description?: string }
 * Records a HintUse and creates a HINT_REVEAL SessionEvent.
 */
router.post("/:id/hints", requireAuth, async (req: Request<{ id: string }>, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const userId = req.user!.sub;
    const { hintIndex = 1, penalty = 5, description } = req.body ?? {};

    const session = await prisma.session.findUnique({
      where: { id },
      select: { userId: true },
    });
    if (!session) {
      res.status(404).json({ ok: false, error: `Session '${id}' not found` });
      return;
    }
    if (session.userId !== userId && req.user!.role !== "ADMIN") {
      res.status(403).json({ ok: false, error: "Forbidden" });
      return;
    }

    const desc = description ?? `Hint ${hintIndex} revealed (-${penalty} pts)`;

    const [hintUse, event] = await prisma.$transaction([
      prisma.hintUse.create({
        data: {
          sessionId: id,
          hintIndex: Number(hintIndex),
        },
      }),
      prisma.sessionEvent.create({
        data: {
          sessionId: id,
          occurredAt: new Date(),
          type: "HINT_REVEAL",
          payloadJson: {
            hintIndex: Number(hintIndex),
            penalty: Number(penalty),
            description: desc,
          },
        },
      }),
    ]);

    res.status(201).json({ ok: true, data: { hintUse, event } });
  } catch (err) {
    next(err);
  }
});

export default router;

