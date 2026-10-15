import { Router, Request, Response } from "express";
import { clerkClient } from "@clerk/express";
import { prisma } from "../lib/prisma";
import { requireAuth, invalidateClerkUserCache } from "../middleware/auth";

const router = Router();

/**
 * POST /api/users/me/request-recruiter-access
 *
 * Allows an authenticated user to request recruiter privileges.
 * Sets requestedRole: "RECRUITER", approvalStatus: "PENDING" on the user's
 * Clerk private metadata via the backend SDK, and updates the synced Postgres row.
 * Role remains CANDIDATE until approved by an admin.
 */
router.post(
  "/me/request-recruiter-access",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.sub;

    try {
      // 1. Update Clerk private metadata via Backend SDK
      await clerkClient.users.updateUserMetadata(userId, {
        privateMetadata: {
          requestedRole: "RECRUITER",
          approvalStatus: "PENDING",
        },
      });

      // 2. Invalidate in-memory cache for this user
      invalidateClerkUserCache(userId);

      // 3. Keep synced Postgres row consistent
      const user = await prisma.user.upsert({
        where: { id: userId },
        update: {
          requestedRole: "RECRUITER",
          approvalStatus: "PENDING",
        },
        create: {
          id: userId,
          email: req.user!.email,
          name: req.user!.email.split("@")[0] || "User",
          role: "CANDIDATE",
          requestedRole: "RECRUITER",
          approvalStatus: "PENDING",
        },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          requestedRole: true,
          approvalStatus: true,
          createdAt: true,
        },
      });

      res.json({
        ok: true,
        message: "Recruiter access requested successfully. Awaiting administrator approval.",
        user,
      });
    } catch (err: any) {
      console.error("[users] Failed to request recruiter access:", err);
      res.status(500).json({ ok: false, error: err.message || "Failed to request recruiter access" });
    }
  }
);

/**
 * GET /api/users/me
 * Returns the current authenticated user's profile and approval status.
 */
router.get(
  "/me",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
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
        createdAt: true,
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
  }
);

export default router;
