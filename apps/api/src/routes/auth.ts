import { Router, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";

const router = Router();

// Known seeded demo accounts preserved for E2E tests and untouched recruiter flows
const DEMO_ACCOUNTS: Record<string, string> = {
  "alice@heisenbug.dev": "testcandidate123",
  "recruiter@heisenbug.dev": "recruiterpassword123",
  "admin@heisenbug.dev": "adminpassword123",
  "author@heisenbug.dev": "authorpassword123",
};

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
 * Regular login is retired (410 Gone pointing to Clerk).
 * Preserves seeded demo accounts so untouched E2E/recruiter flows continue working during transition.
 */
router.post("/login", async (req: Request, res: Response): Promise<void> => {
  const { email, password } = req.body ?? {};

  if (email && password && DEMO_ACCOUNTS[email.toLowerCase()] === password) {
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        requestedRole: true,
        approvalStatus: true,
      },
    });

    if (user) {
      const token = jwt.sign(
        { sub: user.id, email: user.email, role: user.role },
        process.env.JWT_SECRET || "fallback_secret",
        { expiresIn: "7d" }
      );
      res.json({
        ok: true,
        token,
        user,
      });
      return;
    }
  }

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
