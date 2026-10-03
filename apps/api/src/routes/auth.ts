import { Router, Request, Response } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { signToken } from "../lib/jwt";

const router = Router();

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

/**
 * POST /api/auth/login
 * Body: { email, password }
 * Returns: { ok: true, token, user: { id, email, name, role } }
 *
 * NOTE: The User model in Prisma does NOT have a passwordHash column —
 * this is by design (auth will use a dedicated auth table or provider later).
 * For this chunk we store hashed passwords in a small parallel table
 * called `user_credentials` created via a raw migration addendum.
 *
 * ACTUALLY: to keep the schema clean for this chunk we extend the User model
 * with a `passwordHash` column via a new Prisma migration.
 * See: packages/db/prisma/migrations/…/add_password_hash.sql
 */
router.post("/login", async (req: Request, res: Response): Promise<void> => {
  const parsed = LoginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: "Invalid request body", fieldErrors: parsed.error.flatten().fieldErrors });
    return;
  }

  const { email, password } = parsed.data;

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, name: true, role: true, passwordHash: true },
  });

  if (!user || !user.passwordHash) {
    res.status(401).json({ ok: false, error: "Invalid credentials" });
    return;
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    res.status(401).json({ ok: false, error: "Invalid credentials" });
    return;
  }

  const token = signToken({ sub: user.id, email: user.email, role: user.role });

  res.json({
    ok: true,
    token,
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
  });
});

/**
 * GET /api/auth/me  — returns the current user from the JWT (no DB round-trip)
 */
import { requireAuth } from "../middleware/auth";

router.get("/me", requireAuth, (req: Request, res: Response): void => {
  res.json({ ok: true, user: req.user });
});

export default router;
