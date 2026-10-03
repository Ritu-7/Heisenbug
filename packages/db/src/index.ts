export { PrismaClient } from "@prisma/client";
export type {
  User,
  Problem,
  ProblemVersion,
  Variant,
  Session,
  SessionEvent,
  Submission,
  HintUse,
  Assessment,
  AssessmentProblem,
  Invitation,
} from "@prisma/client";
export {
  Role,
  ProblemVersionStatus,
  SessionMode,
  SessionStatus,
} from "@prisma/client";

import { PrismaClient } from "@prisma/client";

// Singleton pattern for the Prisma client — safe for both app and edge runtimes
declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

export const prisma: PrismaClient =
  global.__prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "warn", "error"]
        : ["warn", "error"],
  });

if (process.env.NODE_ENV !== "production") {
  global.__prisma = prisma;
}
