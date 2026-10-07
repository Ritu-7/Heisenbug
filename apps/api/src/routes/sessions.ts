import { Router, Request, Response } from "express";
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
router.get("/", requireAuth, async (req: Request, res: Response): Promise<void> => {
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
        take: 1,
      },
    },
  });

  res.json({ ok: true, data: sessions });
});

/**
 * POST /api/sessions
 * Body: { versionId, variantId?, mode, deadline? }
 * Auth: required — userId comes from the JWT, not the request body
 *
 * If variantId is omitted, picks the first variant for the given versionId.
 */
router.post("/", requireAuth, async (req: Request, res: Response): Promise<void> => {
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

  const session = await prisma.session.create({
    data: {
      userId,
      versionId,
      variantId: resolvedVariantId,
      mode,
      status: "ACTIVE",
      deadline: deadline ? new Date(deadline) : null,
    },
  });

  res.status(201).json({ ok: true, data: session });
});

/**
 * GET /api/sessions/:id
 * Returns the session row joined with its ProblemVersion and Variant.
 * Auth: required — only the owning user may view their own session.
 */
router.get("/:id", requireAuth, async (req: Request<{ id: string }>, res: Response): Promise<void> => {
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

  // Enforce object-level access:
  // - Candidate owning the session
  // - Recruiter who created the assessment associated with this session's invitation
  // - System administrator
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
});

/**
 * GET /api/sessions/:id/submissions
 * Returns all submissions for this session, ordered by createdAt desc.
 * Empty array (not 404) when none exist yet.
 */
router.get("/:id/submissions", requireAuth, async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  const { id } = req.params;
  const userId = req.user!.sub;

  // Verify session exists and caller is authorized (owner, assigned recruiter, or admin)
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

  res.json({ ok: true, data: submissions }); // real empty array when no rows exist
});

/**
 * GET /api/sessions/:id/events
 * Returns all events for this session, ordered by occurredAt asc.
 * Used by the workspace to restore saved code and replay session history.
 */
router.get("/:id/events", requireAuth, async (req: Request<{ id: string }>, res: Response): Promise<void> => {
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
});

/**
 * POST /api/sessions/:id/events
 * Body: { occurredAt, type, payloadJson? }
 * Inserts a real SessionEvent row and returns it.
 */
router.post("/:id/events", requireAuth, async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  const { id } = req.params;
  const userId = req.user!.sub;

  const parsed = CreateEventSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: "Invalid request body", fieldErrors: parsed.error.flatten().fieldErrors });
    return;
  }

  // Verify session exists and caller owns it
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
});

/**
 * POST /api/sessions/:id/hints
 * Body: { hintIndex?: number, penalty?: number, description?: string }
 * Records a HintUse and creates a HINT_REVEAL SessionEvent.
 */
router.post("/:id/hints", requireAuth, async (req: Request<{ id: string }>, res: Response): Promise<void> => {
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
});

export default router;
