import { Request, Response, NextFunction } from "express";
import { verifyToken, JwtPayload } from "../lib/jwt";

// Augment Express Request so downstream handlers get req.user typed
declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

/**
 * Reads the Authorization: Bearer <token> header, verifies it, and attaches
 * the decoded payload to req.user.  Returns 401 on missing or invalid tokens.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    res.status(401).json({ ok: false, error: "Missing or malformed Authorization header" });
    return;
  }

  const token = header.slice(7);
  try {
    req.user = verifyToken(token);
    next();
  } catch {
    res.status(401).json({ ok: false, error: "Invalid or expired token" });
  }
}

/**
 * Enforces that req.user has one of the allowed roles.
 * Must be preceded by requireAuth in the middleware chain.
 * Returns 403 on missing or insufficient role.
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
