// ─────────────────────────────────────────────────────────────────────────────
// Shared TypeScript types for Heisenbug
// These mirror the Prisma models so the frontend never imports from @prisma/client
// directly and the API boundary stays explicit.
// ─────────────────────────────────────────────────────────────────────────────

// ── Enums ────────────────────────────────────────────────────────────────────

export type Role = "CANDIDATE" | "RECRUITER" | "AUTHOR" | "ADMIN";

export type ProblemVersionStatus =
  | "DRAFT"
  | "VALIDATING"
  | "PUBLISHED"
  | "NEEDS_REVISION";

export type SessionMode = "PRACTICE" | "ASSESSMENT";

export type SessionStatus = "ACTIVE" | "SUBMITTED" | "EXPIRED";

// ── Core entities ─────────────────────────────────────────────────────────────

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  createdAt: string; // ISO-8601 string (JSON-safe)
}

export interface Problem {
  id: string;
  slug: string;
  title: string;
  track: string;
  difficulty: string;
  estMinutes: number;
  skills: string[];
  stack: string;
  createdAt: string;
}

export interface ProblemVersion {
  id: string;
  problemId: string;
  version: number;
  status: ProblemVersionStatus;
  descriptionMd: string;
  editorialMd: string;
  solutionMd: string;
  createdAt: string;
}

export interface Variant {
  id: string;
  versionId: string;
  paramsJson: Record<string, unknown>;
}

export interface Session {
  id: string;
  userId: string;
  versionId: string;
  variantId: string;
  mode: SessionMode;
  status: SessionStatus;
  deadline: string | null; // ISO-8601 or null
  createdAt: string;
}

export interface SessionEvent {
  id: string;
  sessionId: string;
  occurredAt: string;
  type: string;
  payloadJson: Record<string, unknown>;
}

export interface Submission {
  id: string;
  sessionId: string;
  diffText: string;
  verdictJson: Verdict;
  score: number;
  createdAt: string;
}

export interface HintUse {
  id: string;
  sessionId: string;
  hintIndex: number;
  createdAt: string;
}

export interface Assessment {
  id: string;
  recruiterId: string;
  title: string;
  timeLimitMinutes: number;
  createdAt: string;
}

export interface AssessmentProblem {
  id: string;
  assessmentId: string;
  versionId: string;
  orderIndex: number;
}

export interface Invitation {
  id: string;
  assessmentId: string;
  candidateEmail: string;
  token: string;
  expiresAt: string;
  sessionId: string | null;
}

// ── Verdict ───────────────────────────────────────────────────────────────────

/** A single graded check in a submission verdict */
export interface VerdictCheck {
  /** Stable identifier for this check, e.g. "AC-1" */
  id: string;
  /** Weight of this check out of 100 */
  weight: number;
  /** Whether this check passed */
  passed: boolean;
  /** Optional human-readable explanation */
  message?: string;
}

/** The full verdict returned after grading a submission */
export interface Verdict {
  /** Overall pass/fail (true when score ≥ pass threshold) */
  passed: boolean;
  /** Aggregate score 0–100 */
  score: number;
  /** Ordered list of individual check results */
  checks: VerdictCheck[];
}

// ── API response wrappers ─────────────────────────────────────────────────────

export interface ApiSuccess<T> {
  ok: true;
  data: T;
}

export interface ApiError {
  ok: false;
  error: string;
  /** Field-level validation errors, if applicable */
  fieldErrors?: Record<string, string[]>;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;

// ── Composite / enriched types used by the API ───────────────────────────────

/** Problem with its current published version — what the problem list returns */
export interface ProblemWithVersion extends Problem {
  currentVersion: ProblemVersion | null;
}

/** Full session context served to the candidate workspace */
export interface SessionContext {
  session: Session;
  problem: Problem;
  version: ProblemVersion;
  variant: Variant;
}
