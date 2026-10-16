/**
 * Typed fetch helpers for the Heisenbug API.
 * All data comes from the real Express/Postgres backend — no stubs.
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

// ── Auth token storage ─────────────────────────────────────────────────────

const TOKEN_KEY = "heisenbug_jwt_token";

export function getAuthToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setAuthToken(token: string): void {
  if (typeof window !== "undefined") {
    localStorage.setItem(TOKEN_KEY, token);
  }
}

export function removeAuthToken(): void {
  if (typeof window !== "undefined") {
    localStorage.removeItem(TOKEN_KEY);
  }
}

// ── Wire types ─────────────────────────────────────────────────────────────

export interface User {
  id: string;
  email: string;
  name: string;
  role: "CANDIDATE" | "RECRUITER" | "AUTHOR" | "ADMIN";
  requestedRole?: "RECRUITER" | null;
  approvalStatus?: "NONE" | "PENDING" | "APPROVED" | "REJECTED";
}

export interface ProblemVersionSummary {
  id: string;
  version: number;
  status: string;
  createdAt: string;
}

export interface Problem {
  id: string;
  slug: string;
  title: string;
  track: string;
  difficulty: "easy" | "medium" | "hard";
  estMinutes: number;
  skills: string[];
  stack: string;
  createdAt: string;
  currentVersion: ProblemVersionSummary | null;
  checkCount: number;
  /** null = unauthenticated guest; false = authenticated, not solved; true = solved (passing submission) */
  solved: boolean | null;
  /** null = < 5 submissions (not enough data); 0–100 integer percentage when enough data exists */
  solveRate: number | null;
}

export interface Submission {
  id: string;
  sessionId: string;
  diffText: string;
  verdictJson: unknown;
  score: number;
  confidencePct?: number | null;
  createdAt: string;
}

export interface Session {
  id: string;
  userId: string;
  versionId: string;
  variantId: string;
  mode: "PRACTICE" | "ASSESSMENT";
  status: "ACTIVE" | "SUBMITTED" | "EXPIRED";
  deadline: string | null;
  createdAt: string;
  version?: {
    id: string;
    version: number;
    status: string;
    createdAt: string;
    problem: Problem;
  };
  variant?: {
    id: string;
    versionId: string;
    paramsJson: unknown;
  };
  submissions?: Submission[];
  user?: {
    id: string;
    email: string;
    name: string;
  };
  invitation?: {
    candidateEmail?: string;
    assessment?: {
      id: string;
      title: string;
      recruiterId: string;
      timeLimitMinutes?: number;
    };
  };
}

export interface ProblemsResponse {
  ok: boolean;
  data: Problem[];
}

export interface SessionsResponse {
  ok: boolean;
  data: Session[];
}

export interface SessionResponse {
  ok: boolean;
  data: Session;
}

export interface ApiError {
  ok: false;
  error: string;
}

export async function getActiveToken(): Promise<string | null> {
  if (typeof window !== "undefined") {
    try {
      const clerk = (window as any).Clerk;
      if (clerk?.session) {
        const token = await clerk.session.getToken();
        if (token) {
          localStorage.setItem(TOKEN_KEY, token);
          return token;
        }
      }
    } catch {
      // fallback to stored token
    }
    const stored = localStorage.getItem(TOKEN_KEY);
    if (stored) return stored;

    const match = document.cookie.match(/(?:^|;\s*)__session=([^;]+)/);
    if (match && match[1]) {
      return decodeURIComponent(match[1]);
    }
  }
  return null;
}

// ── Fetch helpers ──────────────────────────────────────────────────────────

export async function apiFetch<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const token = await getActiveToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options?.headers as Record<string, string>,
  };

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    const detailMsg = (body as any)?.detail ? `: ${(body as any).detail}` : "";
    const errorMsg = ((body as any)?.error ?? res.statusText) + detailMsg;
    throw new Error(errorMsg);
  }

  return res.json() as Promise<T>;
}

// ── Query functions (used by TanStack Query) ───────────────────────────────

/** Get current user from /api/auth/me */
export async function fetchCurrentUser(): Promise<User | null> {
  const token = await getActiveToken();
  if (!token) return null;
  try {
    const res = await apiFetch<{ ok: boolean; user: User }>("/api/auth/me");
    return res.user;
  } catch {
    return null;
  }
}

/** Fetch all problems with their published version summary. */
export async function fetchProblems(): Promise<Problem[]> {
  const data = await apiFetch<ProblemsResponse>("/api/problems");
  return data.data;
}

/** Fetch user's sessions */
export async function fetchUserSessions(): Promise<Session[]> {
  const token = await getActiveToken();
  if (!token) return [];
  const data = await apiFetch<SessionsResponse>("/api/sessions");
  return data.data;
}

/** Fetch a specific session by ID */
export async function fetchSession(sessionId: string): Promise<Session> {
  const data = await apiFetch<SessionResponse>(`/api/sessions/${sessionId}`);
  return data.data;
}

/** Create a new session */
export async function createSession(versionId: string, mode: "PRACTICE" | "ASSESSMENT" = "PRACTICE"): Promise<Session> {
  const data = await apiFetch<SessionResponse>("/api/sessions", {
    method: "POST",
    body: JSON.stringify({ versionId, mode }),
  });
  return data.data;
}

// ── Starter code ───────────────────────────────────────────────────────────

export interface StarterCode {
  filename: string;
  language: string;
  content: string;
  files: Array<{ path: string; editable: boolean; label: string }>;
}

/** Fetch the starter code from the on-disk problem pack via the API */
export async function fetchStarterCode(slug: string): Promise<StarterCode> {
  const data = await apiFetch<{ ok: boolean; data: StarterCode }>(`/api/problems/${slug}/starter-code`);
  return data.data;
}

// ── Session events ─────────────────────────────────────────────────────────

export interface SessionEvent {
  id: string;
  sessionId: string;
  occurredAt: string;
  type: string;
  payloadJson: unknown;
}

/** Fetch all events for a session (used to restore saved code on load) */
export async function fetchSessionEvents(sessionId: string): Promise<SessionEvent[]> {
  const data = await apiFetch<{ ok: boolean; data: SessionEvent[] }>(`/api/sessions/${sessionId}/events`);
  return data.data;
}

/** Post a single event to a session (autosave, file open, etc.) */
export async function postSessionEvent(
  sessionId: string,
  type: string,
  payloadJson: Record<string, unknown>,
): Promise<SessionEvent> {
  const data = await apiFetch<{ ok: boolean; data: SessionEvent }>(`/api/sessions/${sessionId}/events`, {
    method: "POST",
    body: JSON.stringify({
      occurredAt: new Date().toISOString(),
      type,
      payloadJson,
    }),
  });
  return data.data;
}

/** Fetch all submissions for a session */
export async function fetchSessionSubmissions(sessionId: string): Promise<Submission[]> {
  const data = await apiFetch<{ ok: boolean; data: Submission[] }>(`/api/sessions/${sessionId}/submissions`);
  return data.data;
}

/** Unlock/reveal a hint for a session */
export async function postSessionHint(
  sessionId: string,
  hintIndex: number,
  penalty = 5,
  description?: string,
): Promise<{ hintUse: any; event: SessionEvent }> {
  const data = await apiFetch<{ ok: boolean; data: { hintUse: any; event: SessionEvent } }>(`/api/sessions/${sessionId}/hints`, {
    method: "POST",
    body: JSON.stringify({ hintIndex, penalty, description }),
  });
  return data.data;
}

// ── Run / Submit ────────────────────────────────────────────────────────────

export interface VerdictCheck {
  id: string;
  weight: number;
  passed: boolean;
  message?: string;
}

export interface RunResult {
  passed: boolean;
  score: number;
  checks: VerdictCheck[];
  rawOutput: string;
  durationMs: number;
}

export interface SubmitResult {
  submission: Submission;
  verdict: { passed: boolean; score: number; checks: VerdictCheck[] };
  rawOutput: string;
  durationMs: number;
}

/** POST /api/sessions/:id/run — runs visible tests inside Docker */
export async function runSession(sessionId: string): Promise<RunResult> {
  const data = await apiFetch<{ ok: boolean; data: RunResult }>(`/api/sessions/${sessionId}/run`, {
    method: "POST",
  });
  return data.data;
}

/** POST /api/sessions/:id/submit — runs full test suite (visible + hidden) inside grader Docker */
export async function submitSession(sessionId: string, confidencePct?: number | null): Promise<SubmitResult> {
  const data = await apiFetch<{ ok: boolean; data: SubmitResult }>(`/api/sessions/${sessionId}/submit`, {
    method: "POST",
    body: JSON.stringify(confidencePct !== undefined ? { confidencePct } : {}),
  });
  return data.data;
}

// ── Assessment types ───────────────────────────────────────────────────────

export interface AssessmentProblem {
  id: string;
  orderIndex: number;
  version: {
    id: string;
    version: number;
    problem: { id: string; slug: string; title: string; difficulty: string };
  };
}

export interface Assessment {
  id: string;
  recruiterId: string;
  title: string;
  timeLimitMinutes: number;
  createdAt: string;
  problems: AssessmentProblem[];
  _count?: { invitations: number };
}

export type InvitationStatus = "INVITED" | "STARTED" | "SUBMITTED" | "EXPIRED";

export interface Invitation {
  id: string;
  assessmentId: string;
  candidateEmail: string;
  token: string;
  expiresAt: string;
  sessionId: string | null;
  status: InvitationStatus;
}

export interface AssessmentDetail extends Assessment {
  invitations: Invitation[];
}

export interface InvitationPublic {
  token: string;
  candidateEmail: string;
  expiresAt: string;
  assessment: {
    id: string;
    title: string;
    timeLimitMinutes: number;
    problemCount: number;
  };
}

// ── Assessment fetch functions ─────────────────────────────────────────────

/** POST /api/assessments */
export async function createAssessment(body: {
  title: string;
  timeLimitMinutes: number;
  problemVersionId: string;
}): Promise<Assessment> {
  const data = await apiFetch<{ ok: boolean; data: Assessment }>("/api/assessments", {
    method: "POST",
    body: JSON.stringify(body),
  });
  return data.data;
}

/** GET /api/assessments */
export async function fetchAssessments(): Promise<Assessment[]> {
  const data = await apiFetch<{ ok: boolean; data: Assessment[] }>("/api/assessments");
  return data.data;
}

/** GET /api/assessments/:id */
export async function fetchAssessment(id: string): Promise<AssessmentDetail> {
  const data = await apiFetch<{ ok: boolean; data: AssessmentDetail }>(`/api/assessments/${id}`);
  return data.data;
}

/** POST /api/assessments/:id/invitations */
export async function createInvitation(
  assessmentId: string,
  candidateEmail: string,
): Promise<{ invitation: Invitation; inviteUrl: string }> {
  const data = await apiFetch<{ ok: boolean; data: { invitation: Invitation; inviteUrl: string } }>(
    `/api/assessments/${assessmentId}/invitations`,
    { method: "POST", body: JSON.stringify({ candidateEmail }) },
  );
  return data.data;
}

/** GET /api/invitations/:token (public) */
export async function fetchInvitation(token: string): Promise<InvitationPublic> {
  const res = await fetch(`${API_BASE}/api/invitations/${token}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    const err = new Error((body as { error?: string }).error ?? res.statusText) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  const data = await res.json() as { ok: boolean; data: InvitationPublic };
  return data.data;
}

/** POST /api/invitations/:token/start (public) */
export async function startInvitation(token: string): Promise<{
  token: string;
  session: Session;
  assessment: InvitationPublic["assessment"];
}> {
  const res = await fetch(`${API_BASE}/api/invitations/${token}/start`, { method: "POST" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((body as { error?: string }).error ?? res.statusText);
  }
  const data = await res.json() as { ok: boolean; data: { token: string; session: Session; assessment: InvitationPublic["assessment"] } };
  return data.data;
}

// ── Near-Miss Teaching Content ──────────────────────────────────────────

export interface BadPatchNearMiss {
  id: string;
  title: string;
  filename: string;
  code: string;
  explanation: string;
  measuredScore: number;
  maxScore: number;
  summary: string;
  failedChecks: string[];
  passedChecks: string[];
  failureStat: {
    percentage: number | null;
    matchingCount: number;
    totalCount: number;
    formatted: string;
  };
}

export interface ProblemNearMissesResponse {
  slug: string;
  nearMisses: BadPatchNearMiss[];
  totalSubmissions: number;
}

/** GET /api/problems/:slug/near-misses */
export async function fetchProblemNearMisses(slug: string): Promise<ProblemNearMissesResponse> {
  const res = await apiFetch<{ ok: boolean; data: ProblemNearMissesResponse }>(
    `/api/problems/${slug}/near-misses`,
  );
  return res.data;
}

// ── Admin Problem Authoring ───────────────────────────────────────────────

export interface DraftProblemPayload {
  brief: string;
  track?: string;
  difficulty?: string;
  slug?: string;
}

export interface ValidationChecks {
  check1: boolean;
  check2: boolean;
  check3: boolean;
  check4: boolean;
}

export interface ValidationResponse {
  ok: boolean;
  slug: string;
  checks: ValidationChecks;
  allPassed: boolean;
  exitCode: number;
  output: string;
}

/** POST /api/admin/problems/draft (AUTHOR, ADMIN) */
export async function draftProblem(payload: DraftProblemPayload): Promise<{ ok: boolean; data: any }> {
  return apiFetch<{ ok: boolean; data: any }>("/api/admin/problems/draft", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/** POST /api/admin/problems/:slug/validate (AUTHOR, ADMIN) */
export async function validateProblemDraft(slug: string): Promise<ValidationResponse> {
  return apiFetch<ValidationResponse>(`/api/admin/problems/${slug}/validate`, {
    method: "POST",
  });
}

/** POST /api/admin/problems/:slug/publish (ADMIN) */
export async function publishProblemDraft(slug: string): Promise<{ ok: boolean; slug: string; status: string; message: string }> {
  return apiFetch<{ ok: boolean; slug: string; status: string; message: string }>(`/api/admin/problems/${slug}/publish`, {
    method: "POST",
  });
}

/** GET /api/admin/problems (AUTHOR, ADMIN) */
export async function fetchAdminProblems(): Promise<Problem[]> {
  const res = await apiFetch<{ ok: boolean; data: Problem[] }>("/api/admin/problems");
  return res.data;
}

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: "CANDIDATE" | "RECRUITER" | "AUTHOR" | "ADMIN";
  requestedRole?: "RECRUITER" | null;
  approvalStatus: "NONE" | "PENDING" | "APPROVED" | "REJECTED";
  createdAt: string;
  _count?: {
    sessions: number;
    assessments: number;
  };
}

/** GET /api/admin/users (ADMIN) */
export async function fetchAdminUsers(): Promise<AdminUser[]> {
  const res = await apiFetch<{ ok: boolean; data: AdminUser[] }>("/api/admin/users");
  return res.data;
}

/** POST /api/admin/users/:userId/approve-recruiter (ADMIN) */
export async function approveRecruiter(userId: string): Promise<{ ok: boolean; message: string; user: User }> {
  return apiFetch<{ ok: boolean; message: string; user: User }>(`/api/admin/users/${userId}/approve-recruiter`, {
    method: "POST",
  });
}

/** POST /api/admin/users/:userId/reject-recruiter (ADMIN) */
export async function rejectRecruiter(userId: string): Promise<{ ok: boolean; message: string; user: User }> {
  return apiFetch<{ ok: boolean; message: string; user: User }>(`/api/admin/users/${userId}/reject-recruiter`, {
    method: "POST",
  });
}

/** POST /api/users/me/request-recruiter-access */
export async function requestRecruiterAccess(): Promise<{ ok: boolean; message: string; user: User }> {
  return apiFetch<{ ok: boolean; message: string; user: User }>("/api/users/me/request-recruiter-access", {
    method: "POST",
  });
}

// ── Postmortem ──────────────────────────────────────────────────────────────

export interface PostmortemDoc {
  sessionId: string;
  generatedAt: string;

  problem: {
    title: string;
    slug: string;
    track: string;
    difficulty: string;
    estMinutes: number;
    skills: string[];
    ticketSummary: string;
    editorial: string;
  };

  candidate: {
    name: string;
    email: string;
  };

  timeline: {
    sessionStarted: string;
    firstEdit: string | null;
    firstRun: string | null;
    finalSubmit: string | null;
    totalDurationMs: number | null;
    wallClockMinutes: number | null;
  };

  attempts: {
    runCount: number;
    passingRunBeforeSubmit: boolean;
    hintsUsed: Array<{
      hintIndex: number;
      penalty: number;
      description: string;
      at: string;
    }>;
    totalPenalty: number;
  };

  verdict: {
    passed: boolean;
    score: number;
    checks: Array<{
      id: string;
      weight: number;
      passed: boolean;
      message?: string;
    }>;
    submittedAt: string;
    diffText: string;
  };

  narrative: {
    whatBroke: string;
    rootCauseHint: string;
    howLongItTook: string;
    whatWasTried: string;
  };

  shareToken: string | null;
}

/** GET /api/sessions/:id/postmortem — returns structured postmortem from real event timeline */
export async function fetchPostmortem(sessionId: string): Promise<PostmortemDoc> {
  const data = await apiFetch<{ ok: boolean; data: PostmortemDoc }>(`/api/sessions/${sessionId}/postmortem`);
  return data.data;
}

/** POST /api/sessions/:id/postmortem/share — generate (or fetch existing) public share token */
export async function sharePostmortem(sessionId: string): Promise<{ token: string; shareUrl: string; sessionId: string }> {
  const data = await apiFetch<{ ok: boolean; data: { token: string; shareUrl: string; sessionId: string } }>(
    `/api/sessions/${sessionId}/postmortem/share`,
    { method: "POST" },
  );
  return data.data;
}

/** GET /api/postmortems/public/:token — public no-auth endpoint for shared postmortem links */
export async function fetchPublicPostmortem(token: string): Promise<PostmortemDoc> {
  const res = await fetch(`${API_BASE}/api/postmortems/public/${token}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((body as { error?: string }).error ?? res.statusText);
  }
  const data = await res.json() as { ok: boolean; data: PostmortemDoc };
  return data.data;
}
