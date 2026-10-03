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
}

export interface LoginResponse {
  ok: boolean;
  token: string;
  user: User;
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
}

export interface Submission {
  id: string;
  sessionId: string;
  diffText: string;
  verdictJson: unknown;
  score: number;
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

// ── Fetch helpers ──────────────────────────────────────────────────────────

async function apiFetch<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const token = getAuthToken();
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
    throw new Error((body as ApiError).error ?? res.statusText);
  }

  return res.json() as Promise<T>;
}

// ── Query functions (used by TanStack Query) ───────────────────────────────

/** Login with email & password */
export async function loginUser(email: string, password: string): Promise<LoginResponse> {
  const res = await apiFetch<LoginResponse>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  if (res.token) {
    setAuthToken(res.token);
  }
  return res;
}

/** Get current user from /api/auth/me */
export async function fetchCurrentUser(): Promise<User | null> {
  const token = getAuthToken();
  if (!token) return null;
  try {
    const res = await apiFetch<{ ok: boolean; user: { sub: string; email: string; role: User["role"] } }>("/api/auth/me");
    return {
      id: res.user.sub,
      email: res.user.email,
      name: res.user.email.split("@")[0],
      role: res.user.role,
    };
  } catch {
    removeAuthToken();
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
  const token = getAuthToken();
  if (!token) return [];
  const data = await apiFetch<SessionsResponse>("/api/sessions");
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
export async function submitSession(sessionId: string): Promise<SubmitResult> {
  const data = await apiFetch<{ ok: boolean; data: SubmitResult }>(`/api/sessions/${sessionId}/submit`, {
    method: "POST",
  });
  return data.data;
}


