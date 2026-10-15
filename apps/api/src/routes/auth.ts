import { Router, Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";

const router = Router();

/**
 * GET /api/auth/me
 * Returns current authenticated user profile and approval status from Clerk/Postgres mirror.
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
