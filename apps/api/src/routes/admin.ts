import { Router, Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { requireAuth, requireRole } from "../middleware/auth";

const router = Router();

/**
 * GET /api/admin/users
 * Returns list of all registered users with their roles, creation dates,
 * and aggregate activity counts (sessions, recruiter assessments).
 *
 * Exclusively gates on ADMIN role (`requireRole("ADMIN")`) —
 * RECRUITER, AUTHOR, and CANDIDATE users receive HTTP 403 Forbidden.
 */
router.get(
  "/users",
  requireAuth,
  requireRole("ADMIN"),
  async (_req: Request, res: Response): Promise<void> => {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
        _count: {
          select: {
            sessions: true,
            assessments: true,
          },
        },
      },
    });

    res.json({ ok: true, data: users });
  },
);

export default router;
