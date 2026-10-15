import { Request, Response, NextFunction } from "express";
import { getAuth, clerkClient } from "@clerk/express";
import jwt from "jsonwebtoken";

export interface AuthUser {
  sub: string;   // user id (Clerk user ID or legacy id)
  email: string;
  role: string;
}

// Augment Express Request so downstream handlers get req.user typed
declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      rawBody?: Buffer;
    }
  }
}

// In-memory cache for Clerk user profile to avoid hitting Clerk API on every request
const clerkUserCache = new Map<string, { user: any; expiresAt: number }>();

export function invalidateClerkUserCache(userId: string): void {
  clerkUserCache.delete(userId);
}

async function getClerkUser(userId: string) {
  const cached = clerkUserCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.user;
  }
  const user = await clerkClient.users.getUser(userId);
  clerkUserCache.set(userId, { user, expiresAt: Date.now() + 60_000 }); // cache 60s
  return user;
}

/**
 * Clerk session verification middleware.
 * Verifies the Clerk session, extracts { sub, email, role } from Clerk user metadata,
 * and attaches to req.user.
 * Also preserves legacy JWT verification for the passwordless assessment-invite flow.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    // 1. Check if Clerk session is authenticated
    const auth = getAuth(req);
    if (auth && auth.userId) {
      const clerkUser = await getClerkUser(auth.userId);
      const primaryEmailId = clerkUser.primaryEmailAddressId;
      const emailObj =
        clerkUser.emailAddresses?.find((e: any) => e.id === primaryEmailId) ||
        clerkUser.emailAddresses?.[0];
      const email = emailObj?.emailAddress || "";

      // Role source of truth: Clerk user privateMetadata (never unsafeMetadata or publicMetadata)
      const role =
        (clerkUser.privateMetadata?.role as string) ||
        "CANDIDATE";

      req.user = {
        sub: auth.userId,
        email,
        role,
      };
      next();
      return;
    }

    // 2. Fallback check: Authorization Bearer header
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.slice(7);

      // Try legacy JWT verification (used by the assessment-invite flow and seeded test users)
      const secret = process.env.JWT_SECRET;
      if (secret) {
        try {
          const decoded = jwt.verify(token, secret) as any;
          if (decoded && decoded.sub) {
            req.user = {
              sub: decoded.sub,
              email: decoded.email ?? "",
              role: decoded.role ?? "CANDIDATE",
            };
            next();
            return;
          }
        } catch {
          // Token is not a valid legacy JWT either
        }
      }
    }

    res.status(401).json({ ok: false, error: "Unauthorized: valid session required" });
  } catch (err: any) {
    console.error("[auth] Error verifying authentication:", err);
    res.status(401).json({ ok: false, error: "Authentication failed" });
  }
}

/**
 * Enforces that req.user has one of the allowed roles.
 * Must be preceded by requireAuth in the middleware chain.
 * Role is read from the verified Clerk session metadata.
 */
export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ ok: false, error: "Forbidden: insufficient role" });
      return;
    }
    next();
  };
}
