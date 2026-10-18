import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

/**
 * Build the DATABASE_URL with Render-appropriate connection pool parameters
 * appended as query-string args (Prisma connection string format).
 *
 * Render's Postgres closes idle connections after ~5 min, which causes
 * `Error { kind: Closed, cause: None }` when Prisma reuses a stale socket.
 * Capping the pool and setting a short pool_timeout helps surface failures
 * fast rather than hanging, and prevents exhausting Render's connection limit
 * across multiple dyno replicas.
 *
 * Override via env:
 *   PRISMA_CONNECTION_LIMIT  – max open connections per process (default 5)
 *   PRISMA_POOL_TIMEOUT      – seconds to wait for a free slot (default 10)
 */
function buildDatabaseUrl(): string | undefined {
  const raw = process.env.DATABASE_URL;
  if (!raw) return undefined;

  try {
    const url = new URL(raw);
    const limit = process.env.PRISMA_CONNECTION_LIMIT ?? "10";
    const timeout = process.env.PRISMA_POOL_TIMEOUT ?? "30";

    // Only set if not already present in the URL (so local overrides still work)
    if (!url.searchParams.has("connection_limit")) {
      url.searchParams.set("connection_limit", limit);
    }
    if (!url.searchParams.has("pool_timeout")) {
      url.searchParams.set("pool_timeout", timeout);
    }
    return url.toString();
  } catch {
    // Unparseable URL (e.g. prisma:// scheme) — return as-is
    return raw;
  }
}

const tuned = buildDatabaseUrl();
if (tuned && tuned !== process.env.DATABASE_URL) {
  process.env.DATABASE_URL = tuned;
}

export const prisma: PrismaClient =
  global.__prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
    errorFormat: process.env.NODE_ENV === "production" ? "minimal" : "pretty",
  });

function isConnectionError(msg: string): boolean {
  const lower = (msg || "").toLowerCase();
  return (
    lower.includes("closed") ||
    lower.includes("connection") ||
    lower.includes("timeout") ||
    lower.includes("timed out") ||
    lower.includes("econnreset") ||
    lower.includes("econnrefused") ||
    lower.includes("p1001") ||
    lower.includes("p1002") ||
    lower.includes("p1008") ||
    lower.includes("p1017")
  );
}

// Surface connection-pool errors vs data/query errors accurately without misleading labels
(prisma as any).$on?.("error", (e: { message: string; target: string }) => {
  if (isConnectionError(e.message)) {
    console.error("[prisma] pool/connection error (idle connection closed by Postgres):", e.message);
  } else {
    console.error("[prisma] database error:", e.message);
  }
});

if (process.env.NODE_ENV !== "production") {
  global.__prisma = prisma;
}
