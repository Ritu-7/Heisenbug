import { Router, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { signToken } from "../lib/jwt";
import { requireAuth } from "../middleware/auth";

const router = Router();

// Rate limit on login/register attempts: relaxed in dev/test/CI so test suites are not blocked
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === "test" || process.env.CI ? 1000 : 100, // 100 in dev, 1000 in test/CI
  standardHeaders: true,
  legacyHeaders: false,
  statusCode: 429,
  message: {
    ok: false,
    error: "Too many attempts. Please try again after 15 minutes.",
  },
  handler: (_req, res, _next, options) => {
    res.status(options.statusCode).json(options.message);
  },
});

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const RegisterSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters long"),
  name: z.string().min(1, "Name is required"),
  role: z.enum(["CANDIDATE", "RECRUITER"]).default("CANDIDATE"),
});

/**
 * POST /api/auth/register
 * Body: { email, password, name, role? }
 *
 * Candidates register directly with CANDIDATE role and NONE approval status.
 * Recruiters register with CANDIDATE role, requestedRole: RECRUITER, and approvalStatus: PENDING.
 * Admin registration is explicitly blocked from public forms.
 */
router.post("/register", authLimiter, async (req: Request, res: Response): Promise<void> => {
  const parsed = RegisterSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      ok: false,
      error: "Invalid request body",
      fieldErrors: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  const { email, password, name, role: requestedRole } = parsed.data;

  // Check for duplicate email
  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });

  if (existing) {
    res.status(409).json({
      ok: false,
      error: "An account with this email address already exists",
    });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);

  // Candidates get active CANDIDATE role immediately.
  // Recruiters start as CANDIDATE with requestedRole: RECRUITER, approvalStatus: PENDING.
  const isRecruiterRequest = requestedRole === "RECRUITER";
  const user = await prisma.user.create({
    data: {
      email,
      name,
      role: "CANDIDATE",
      requestedRole: isRecruiterRequest ? "RECRUITER" : null,
      approvalStatus: isRecruiterRequest ? "PENDING" : "NONE",
      passwordHash,
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

  const token = signToken({ sub: user.id, email: user.email, role: user.role });

  res.status(201).json({
    ok: true,
    token,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      requestedRole: user.requestedRole,
      approvalStatus: user.approvalStatus,
    },
    message: isRecruiterRequest
      ? "Account created. Recruiter access request is pending approval."
      : "Account created successfully.",
  });
});

/**
 * POST /api/auth/login
 * Body: { email, password }
 * Returns: { ok: true, token, user: { id, email, name, role, requestedRole, approvalStatus } }
 */
router.post("/login", authLimiter, async (req: Request, res: Response): Promise<void> => {
  const parsed = LoginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      ok: false,
      error: "Invalid request body",
      fieldErrors: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  const { email, password } = parsed.data;

  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      requestedRole: true,
      approvalStatus: true,
      passwordHash: true,
    },
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
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      requestedRole: user.requestedRole,
      approvalStatus: user.approvalStatus,
    },
  });
});

/**
 * GET /api/auth/me — returns the current user profile including approval status
 */
router.get("/me", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.sub },
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
    res.status(404).json({ ok: false, error: "User not found" });
    return;
  }

  res.json({ ok: true, user });
});

// ── GOOGLE OAUTH ROUTES ───────────────────────────────────────────────────

/**
 * Helper to get the canonical Google OAuth callback URL based on environment
 */
function getGoogleRedirectUri(req: Request): string {
  if (process.env.GOOGLE_CALLBACK_URL) {
    return process.env.GOOGLE_CALLBACK_URL;
  }
  const host = req.get("host") || "localhost:3001";
  const protocol = req.protocol === "https" || req.get("x-forwarded-proto") === "https" ? "https" : "http";
  return `${protocol}://${host}/api/auth/google/callback`;
}

/**
 * GET /api/auth/google/config
 * Returns whether Google OAuth is configured and the callback URI to be registered.
 */
router.get("/google/config", (_req: Request, res: Response): void => {
  const isConfigured = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
  res.json({
    ok: true,
    configured: isConfigured,
    redirectUri: isConfigured ? getGoogleRedirectUri(_req) : "http://localhost:3001/api/auth/google/callback",
  });
});

/**
 * GET /api/auth/google
 * Initiates Google OAuth consent screen.
 * Query param `context`: "candidate" (default) or "recruiter"
 */
router.get("/google", (req: Request, res: Response): void => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    res.status(503).json({
      ok: false,
      error: "Google OAuth is not configured on this server. Please contact an administrator.",
    });
    return;
  }

  const context = req.query.context === "recruiter" ? "recruiter" : "candidate";
  const state = Buffer.from(JSON.stringify({ context, ts: Date.now() })).toString("base64url");
  const redirectUri = getGoogleRedirectUri(req);

  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", "openid email profile");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("access_type", "online");
  authUrl.searchParams.set("prompt", "select_account");

  res.redirect(authUrl.toString());
});

/**
 * GET /api/auth/google/callback
 * Exchanges authorization code for tokens, finds or creates User, and redirects to frontend with token.
 */
router.get("/google/callback", async (req: Request, res: Response): Promise<void> => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";

  if (!clientId || !clientSecret) {
    res.redirect(`${frontendUrl}/login?error=${encodeURIComponent("Google OAuth not configured")}`);
    return;
  }

  const { code, state, error } = req.query;

  if (error || typeof code !== "string") {
    const errorMsg = (error as string) || "Authentication was cancelled";
    res.redirect(`${frontendUrl}/login?error=${encodeURIComponent(errorMsg)}`);
    return;
  }

  let context = "candidate";
  if (typeof state === "string") {
    try {
      const parsedState = JSON.parse(Buffer.from(state, "base64url").toString("utf-8"));
      if (parsedState.context === "recruiter") {
        context = "recruiter";
      }
    } catch {
      // Ignore state parse errors, default to candidate
    }
  }

  try {
    const redirectUri = getGoogleRedirectUri(req);

    // 1. Exchange code for access_token & id_token
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    if (!tokenResponse.ok) {
      const errBody = await tokenResponse.text();
      console.error("[google-oauth] Token exchange failed:", errBody);
      res.redirect(`${frontendUrl}/login?error=${encodeURIComponent("Failed to exchange Google authorization code")}`);
      return;
    }

    const tokenData = (await tokenResponse.json()) as { access_token?: string; id_token?: string };
    if (!tokenData.access_token) {
      res.redirect(`${frontendUrl}/login?error=${encodeURIComponent("No access token returned from Google")}`);
      return;
    }

    // 2. Fetch user profile from Google UserInfo endpoint
    const userInfoResponse = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    if (!userInfoResponse.ok) {
      res.redirect(`${frontendUrl}/login?error=${encodeURIComponent("Failed to retrieve Google user profile")}`);
      return;
    }

    const googleUser = (await userInfoResponse.json()) as {
      email?: string;
      name?: string;
      sub?: string;
      email_verified?: boolean;
    };

    if (!googleUser.email) {
      res.redirect(`${frontendUrl}/login?error=${encodeURIComponent("Google account did not return an email address")}`);
      return;
    }

    const email = googleUser.email.toLowerCase();
    const name = googleUser.name || email.split("@")[0];

    // 3. Find or create user in Postgres
    let user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      const isRecruiterRequest = context === "recruiter";
      user = await prisma.user.create({
        data: {
          email,
          name,
          role: "CANDIDATE",
          requestedRole: isRecruiterRequest ? "RECRUITER" : null,
          approvalStatus: isRecruiterRequest ? "PENDING" : "NONE",
        },
      });
    }

    // Issue JWT
    const jwtToken = signToken({ sub: user.id, email: user.email, role: user.role });

    // Determine target page
    let target = `${frontendUrl}/dashboard`;
    if (user.role === "RECRUITER" || user.role === "ADMIN") {
      target = `${frontendUrl}/recruiter/dashboard`;
    } else if (context === "recruiter" && user.approvalStatus === "PENDING") {
      target = `${frontendUrl}/recruiter/login?pending=1`;
    }

    // Redirect to frontend with token
    res.redirect(`${target}#token=${encodeURIComponent(jwtToken)}`);
  } catch (err) {
    console.error("[google-oauth] Error in callback handler:", err);
    res.redirect(`${frontendUrl}/login?error=${encodeURIComponent("An error occurred during Google sign in")}`);
  }
});

export default router;
