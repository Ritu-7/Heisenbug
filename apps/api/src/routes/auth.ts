import { Router, Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";

const router = Router();

/**
 * POST /api/auth/register
 * 410 Gone — Custom registration is disabled; users register via Clerk.
 */
router.post("/register", (_req: Request, res: Response): void => {
  res.status(410).json({
    ok: false,
    error: "This registration endpoint has been retired. Please register using Clerk at /login.",
  });
});

/**
 * POST /api/auth/login
 * 410 Gone — Custom password login is disabled; users authenticate via Clerk.
 * Pure 410 Gone with no bypasses or exceptions of any kind.
 */
router.post("/login", (_req: Request, res: Response): void => {
  res.status(410).json({
    ok: false,
    error: "This login endpoint has been retired. Please sign in using Clerk at /login.",
  });
});

/**
 * GET /api/auth/me
 * Returns current authenticated user profile.
 */
router.get("/me", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.sub;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      requestedRole: true,
      approvalStatus: true,
    },
  });

  if (!user) {
    res.json({
      ok: true,
      user: {
        id: userId,
        email: req.user!.email,
        name: req.user!.email.split("@")[0] || "User",
        role: req.user!.role,
        requestedRole: null,
        approvalStatus: "NONE",
      },
    });
    return;
  }

  res.json({ ok: true, user });
});

export default router;
