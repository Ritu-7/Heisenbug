import { Router, Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";

const router = Router();

// ── Retired custom-auth endpoints (410 Gone) ────────────────────────────────
// These endpoints existed in the pre-Clerk architecture.
// Authentication is now handled by Clerk — see /login, /admin/login, /recruiter/login
// in the Next.js frontend, and the clerkMiddleware() + requireAuth() on the backend.
//
// We return 410 Gone (not 404) so:
//   • API clients get a semantically correct "permanently removed" signal
//   • test-clerk-verification.js assertions remain green
//   • curl/Postman users see a clear explanation rather than a generic "Not found"

const RETIRED_AUTH_RESPONSE = {
  ok: false,
  gone: true,
  error:
    "This endpoint has been permanently removed. " +
    "Authentication is handled by Clerk. " +
    "Obtain a Clerk session token from the frontend and send it as: Authorization: Bearer <token>. " +
    "See /api/auth/me to retrieve the application user profile.",
} as const;

router.post("/login", (_req: Request, res: Response): void => {
  res.status(410).json(RETIRED_AUTH_RESPONSE);
});

router.post("/register", (_req: Request, res: Response): void => {
  res.status(410).json(RETIRED_AUTH_RESPONSE);
});

// ── Active endpoints ─────────────────────────────────────────────────────────

/**
 * GET /api/auth/me
 * Returns current authenticated user profile and approval status from Clerk/Postgres mirror.
 *
 * Requires: Authorization: Bearer <Clerk session token>
 * The clerkMiddleware() parses the token; requireAuth() enforces it.
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
    // User is authenticated in Clerk but not yet mirrored to Postgres.
    // This can happen if the webhook hasn't fired yet (e.g. first request
    // just after Clerk sign-up). Return Clerk data as a best-effort response.
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
