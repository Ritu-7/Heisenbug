"use client";

import dynamic from "next/dynamic";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useState, useCallback, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import {
  fetchStarterCode,
  fetchUserSessions,
  fetchSessionEvents,
  postSessionEvent,
  createSession,
  runSession,
  submitSession,
  loginUser,
  getAuthToken,
  type Session,
  type SessionEvent,
  type RunResult,
  type SubmitResult,
  type VerdictCheck,
} from "@/lib/api";
import { DifficultyBadge, TrackBadge } from "@/components/badge";
import { cn } from "@/lib/utils";

// Monaco must be dynamically imported to skip SSR
const CodeEditor = dynamic(
  () => import("@/components/code-editor").then((m) => m.CodeEditor),
  { ssr: false },
);

// ── Types ──────────────────────────────────────────────────────────────────

type Tab = "description" | "hints" | "editorial" | "solution" | "submissions";

type ProblemFull = {
  id: string;
  slug: string;
  title: string;
  track: string;
  difficulty: "easy" | "medium" | "hard";
  estMinutes: number;
  skills: string[];
  currentVersion: {
    id: string;
    descriptionMd: string;
    editorialMd: string;
    solutionMd: string;
  };
};

// ── Constants ──────────────────────────────────────────────────────────────

const TABS: { id: Tab; label: string }[] = [
  { id: "description", label: "Description" },
  { id: "hints",       label: "Hints" },
  { id: "editorial",   label: "Editorial" },
  { id: "solution",    label: "Solution" },
  { id: "submissions", label: "Submissions" },
];

const AUTOSAVE_DELAY_MS = 2000;
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

// ── Sub-components ─────────────────────────────────────────────────────────

function TabBar({ active, onSelect }: { active: Tab; onSelect: (t: Tab) => void }) {
  return (
    <div className="flex border-b border-border bg-surface overflow-x-auto shrink-0">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onSelect(tab.id)}
          className={cn(
            "px-4 py-3 text-xs font-medium whitespace-nowrap transition-colors border-b-2 -mb-px",
            active === tab.id
              ? "border-accent text-accent"
              : "border-transparent text-text-secondary hover:text-text",
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

function SaveStatus({ status }: { status: "idle" | "saving" | "saved" | "error" }) {
  return (
    <span className={cn(
      "text-[10px] font-mono transition-colors",
      status === "saving" && "text-warning",
      status === "saved"  && "text-pass",
      status === "error"  && "text-fail",
      status === "idle"   && "text-transparent",
    )}>
      {status === "saving" && "● Saving..."}
      {status === "saved"  && "✓ Saved to database"}
      {status === "error"  && "✗ Save failed"}
    </span>
  );
}

function MarkdownContent({ md, emptyMessage }: { md: string; emptyMessage: string }) {
  if (!md?.trim()) {
    return (
      <div className="py-12 text-center text-text-secondary">
        <p className="text-sm italic">{emptyMessage}</p>
      </div>
    );
  }
  return (
    <div className="prose prose-sm max-w-none text-text leading-relaxed p-4
      prose-headings:font-serif prose-headings:text-text
      prose-code:font-mono prose-code:text-accent prose-code:bg-accent-soft prose-code:px-1 prose-code:rounded
      prose-pre:bg-[#1e1e1e] prose-pre:text-neutral-200 prose-pre:rounded-lg
      prose-a:text-accent prose-a:no-underline hover:prose-a:underline
      prose-table:text-sm prose-th:text-text-secondary
      prose-strong:text-text prose-blockquote:border-accent/40 prose-blockquote:text-text-secondary">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{md}</ReactMarkdown>
    </div>
  );
}

function VerdictPanel({ result, kind }: { result: RunResult | null; kind: "run" | "submit" }) {
  if (!result) return null;

  const totalWeight = result.checks.reduce((sum, c) => sum + c.weight, 0);

  return (
    <div className={cn(
      "border-t px-4 py-3 space-y-2 shrink-0",
      result.passed ? "border-pass/30 bg-pass-soft" : "border-fail/30 bg-fail-soft",
    )}>
      <div className="flex items-center justify-between">
        <span className={cn("text-xs font-semibold font-mono", result.passed ? "text-pass" : "text-fail")}>
          {kind === "run" ? "▶ Run result" : "🏁 Submit verdict"}
          {" — "}
          {result.score}/{totalWeight} pts
          {" "}({Math.round((result.score / totalWeight) * 100)}%)
        </span>
        <span className="text-[10px] font-mono text-text-secondary">
          {(result.durationMs / 1000).toFixed(1)}s
        </span>
      </div>

      <div className="space-y-1">
        {result.checks.map((check: VerdictCheck) => (
          <div key={check.id} className="flex items-start gap-2 text-[11px] font-mono">
            <span className={cn("mt-0.5 shrink-0", check.passed ? "text-pass" : "text-fail")}>
              {check.passed ? "✓" : "✗"}
            </span>
            <span className={check.passed ? "text-pass" : "text-fail"}>
              [{check.id}:{check.weight}pts]
            </span>
            {!check.passed && check.message && (
              <span className="text-fail/80 truncate">{check.message}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function SubmissionsPanel({ sessionId }: { sessionId: string | null }) {
  const { data: submissions = [], isLoading } = useQuery({
    queryKey: ["submissions", sessionId],
    queryFn: async () => {
      if (!sessionId) return [];
      const res = await fetch(`${API_BASE}/api/sessions/${sessionId}/submissions`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("heisenbug_jwt_token")}` },
      });
      const data = await res.json();
      return data.data ?? [];
    },
    enabled: !!sessionId,
  });

  if (!sessionId) return (
    <div className="p-6 text-center text-text-secondary text-sm">Start a session first.</div>
  );

  if (isLoading) return (
    <div className="p-6 animate-pulse space-y-2"><div className="h-12 bg-surface-2 rounded" /></div>
  );

  if (submissions.length === 0) return (
    <div className="py-16 text-center text-text-secondary space-y-2">
      <p className="text-sm font-medium text-text">No submissions yet</p>
      <p className="text-xs max-w-xs mx-auto">
        Click "Submit" to run the full grader and record your verdict.
      </p>
    </div>
  );

  return (
    <div className="p-4 space-y-2">
      {submissions.map((sub: { id: string; score: number; createdAt: string; verdictJson: unknown }) => (
        <div key={sub.id} className="p-3 rounded-lg border border-border bg-surface-2">
          <div className="flex items-center justify-between text-xs font-mono">
            <span className="text-text-secondary">{new Date(sub.createdAt).toLocaleString()}</span>
            <span className={cn("font-semibold", sub.score >= 70 ? "text-pass" : "text-fail")}>
              {sub.score}/100 pts
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function WorkspacePage({ params }: { params: { slug: string } }) {
  const { slug } = params;
  const queryClient = useQueryClient();

  // Auto-login test user
  const [authed, setAuthed] = useState(false);
  useEffect(() => {
    async function init() {
      if (getAuthToken()) { setAuthed(true); return; }
      try { await loginUser("alice@heisenbug.dev", "testcandidate123"); setAuthed(true); }
      catch { /* ignore */ }
    }
    init();
  }, []);

  // ── UI state ──────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<Tab>("description");
  const [code, setCode] = useState<string>("");
  const [codeInitialized, setCodeInitialized] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [runResult, setRunResult] = useState<RunResult | null>(null);
  const [submitResult, setSubmitResult] = useState<SubmitResult | null>(null);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Query: Problem ────────────────────────────────────────────────────
  const { data: problem, isLoading: problemLoading, isError: problemError } = useQuery({
    queryKey: ["problem", slug],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/problems/${slug}`);
      if (!res.ok) throw new Error("Problem not found");
      const data = await res.json();
      return data.data as ProblemFull;
    },
  });

  // ── Query: Starter code from problem pack disk ────────────────────────
  const { data: starterCode } = useQuery({
    queryKey: ["starter-code", slug],
    queryFn: () => fetchStarterCode(slug),
    staleTime: Infinity,
  });

  // ── Query: User's sessions ────────────────────────────────────────────
  const { data: sessions = [] } = useQuery({
    queryKey: ["sessions"],
    queryFn: fetchUserSessions,
    enabled: authed,
  });

  const activeSession: Session | undefined = sessions.find(
    (s) => s.status === "ACTIVE" && (s.version?.problem as { slug: string } | undefined)?.slug === slug,
  );

  // ── Mutation: Create session ──────────────────────────────────────────
  const createSessionMutation = useMutation({
    mutationFn: async () => {
      const versionId = problem?.currentVersion?.id;
      if (!versionId) throw new Error("Version not found");
      return createSession(versionId, "PRACTICE");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["sessions"] }),
  });

  // ── Query: Events (restore last CODE_SAVE) ────────────────────────────
  const { data: events = [] } = useQuery({
    queryKey: ["events", activeSession?.id],
    queryFn: () => fetchSessionEvents(activeSession!.id),
    enabled: !!activeSession?.id,
  });

  // Initialize code from events → starter code
  useEffect(() => {
    if (codeInitialized) return;
    const codeSaves = (events as SessionEvent[])
      .filter((e) => e.type === "CODE_SAVE")
      .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());

    if (codeSaves.length > 0) {
      const payload = codeSaves[0].payloadJson as { code?: string };
      if (payload?.code) { setCode(payload.code); setCodeInitialized(true); return; }
    }
    if (starterCode?.content) { setCode(starterCode.content); setCodeInitialized(true); }
  }, [events, starterCode, codeInitialized]);

  // ── Autosave ──────────────────────────────────────────────────────────
  const handleCodeChange = useCallback((newCode: string) => {
    setCode(newCode);
    if (!activeSession?.id) return;
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    setSaveStatus("saving");
    autosaveTimerRef.current = setTimeout(async () => {
      try {
        await postSessionEvent(activeSession.id, "CODE_SAVE", { code: newCode });
        setSaveStatus("saved");
        queryClient.invalidateQueries({ queryKey: ["events", activeSession.id] });
        setTimeout(() => setSaveStatus("idle"), 3000);
      } catch { setSaveStatus("error"); }
    }, AUTOSAVE_DELAY_MS);
  }, [activeSession?.id, queryClient]);

  // ── Run mutation ──────────────────────────────────────────────────────
  const runMutation = useMutation({
    mutationFn: () => {
      if (!activeSession?.id) throw new Error("No active session");
      return runSession(activeSession.id);
    },
    onSuccess: (data) => {
      setRunResult(data);
      setSubmitResult(null); // clear old submit result when re-running
    },
  });

  // ── Submit mutation ───────────────────────────────────────────────────
  const submitMutation = useMutation({
    mutationFn: () => {
      if (!activeSession?.id) throw new Error("No active session");
      return submitSession(activeSession.id);
    },
    onSuccess: (data) => {
      setSubmitResult(data);
      setRunResult(null);
      queryClient.invalidateQueries({ queryKey: ["submissions", activeSession?.id] });
    },
  });

  // ── Render ────────────────────────────────────────────────────────────

  if (problemLoading) return (
    <div className="flex h-[calc(100vh-56px)] items-center justify-center">
      <span className="text-sm text-text-secondary font-mono animate-pulse">Loading workspace...</span>
    </div>
  );

  if (problemError || !problem) return (
    <div className="flex h-[calc(100vh-56px)] flex-col items-center justify-center gap-4">
      <p className="text-sm text-fail">Problem not found or not yet published.</p>
      <Link href="/" className="text-xs text-accent hover:underline font-mono">← Back to catalogue</Link>
    </div>
  );

  const isRunning  = runMutation.isPending;
  const isSubmitting = submitMutation.isPending;
  const verdictToShow = submitResult
    ? { ...submitResult.verdict, rawOutput: submitResult.rawOutput, durationMs: submitResult.durationMs }
    : runResult;

  return (
    <div className="flex flex-col h-[calc(100vh-56px)] overflow-hidden">
      {/* ── Header ── */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-surface border-b border-border shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <Link href="/" className="text-text-secondary hover:text-text transition-colors text-xs font-mono">← catalogue</Link>
          <span className="text-border">│</span>
          <h1 className="text-sm font-semibold text-text truncate">{problem.title}</h1>
          <div className="hidden sm:flex items-center gap-1.5">
            <TrackBadge track={problem.track} />
            <DifficultyBadge difficulty={problem.difficulty} />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <SaveStatus status={saveStatus} />

          {/* Session status */}
          {activeSession ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-mono text-pass">
              <span className="h-1.5 w-1.5 rounded-full bg-pass animate-pulse" />
              Active session
            </span>
          ) : (
            <button
              onClick={() => createSessionMutation.mutate()}
              disabled={createSessionMutation.isPending}
              className="text-xs font-mono px-3 py-1.5 rounded-md bg-accent text-white hover:bg-accent/90 disabled:opacity-50 transition-colors"
            >
              {createSessionMutation.isPending ? "Starting..." : "Start session"}
            </button>
          )}

          {/* ▶ Run — real Docker execution */}
          <button
            onClick={() => runMutation.mutate()}
            disabled={!activeSession || isRunning || isSubmitting}
            className={cn(
              "px-3.5 py-1.5 rounded-md text-xs font-semibold font-mono transition-colors",
              "bg-surface-2 text-text border border-border",
              "hover:bg-accent-soft hover:text-accent hover:border-accent/40",
              "disabled:opacity-40 disabled:cursor-not-allowed",
            )}
          >
            {isRunning ? "▶ Running..." : "▶ Run"}
          </button>

          {/* Submit — runs full test suite with hidden tests */}
          <button
            onClick={() => submitMutation.mutate()}
            disabled={!activeSession || isRunning || isSubmitting}
            className={cn(
              "px-3.5 py-1.5 rounded-md text-xs font-semibold font-mono transition-colors",
              "bg-accent text-white",
              "hover:bg-accent/90",
              "disabled:opacity-40 disabled:cursor-not-allowed",
            )}
          >
            {isSubmitting ? "Submitting..." : "Submit"}
          </button>
        </div>
      </div>

      {/* Run/Submit error banners */}
      {runMutation.isError && (
        <div className="px-4 py-2 text-xs font-mono text-fail bg-fail-soft border-b border-fail/30 shrink-0">
          Run error: {(runMutation.error as Error).message}
        </div>
      )}
      {submitMutation.isError && (
        <div className="px-4 py-2 text-xs font-mono text-fail bg-fail-soft border-b border-fail/30 shrink-0">
          Submit error: {(submitMutation.error as Error).message}
        </div>
      )}

      {/* ── Two-panel layout ── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Left: Description tabs */}
        <div className="w-[44%] flex flex-col border-r border-border min-h-0">
          <TabBar active={activeTab} onSelect={setActiveTab} />
          <div className="flex-1 overflow-y-auto">
            {activeTab === "description" && (
              <MarkdownContent md={problem.currentVersion.descriptionMd} emptyMessage="Description not yet written." />
            )}
            {activeTab === "hints" && (
              <MarkdownContent md="" emptyMessage="No hints written yet for this problem." />
            )}
            {activeTab === "editorial" && (
              <MarkdownContent md={problem.currentVersion.editorialMd} emptyMessage="Editorial not yet written. Come back after attempting the problem." />
            )}
            {activeTab === "solution" && (
              <MarkdownContent md={problem.currentVersion.solutionMd} emptyMessage="Reference solution not yet written." />
            )}
            {activeTab === "submissions" && (
              <SubmissionsPanel sessionId={activeSession?.id ?? null} />
            )}
          </div>
        </div>

        {/* Right: Editor + verdict */}
        <div className="flex-1 flex flex-col min-h-0 bg-[#1e1e1e]">
          {/* File tab bar */}
          <div className="flex items-center bg-[#252526] border-b border-[#3c3c3c] shrink-0">
            <div className="flex items-center gap-2 px-4 py-2 bg-[#1e1e1e] border-r border-[#3c3c3c] border-t-2 border-t-accent">
              <span className="text-xs font-mono text-neutral-300">{starterCode?.filename ?? "src/charge.js"}</span>
              {saveStatus === "saving" && (
                <span className="h-1.5 w-1.5 rounded-full bg-warning" title="Unsaved changes" />
              )}
            </div>
            <span className="ml-auto px-3 text-[10px] font-mono text-neutral-500">
              {starterCode?.language ?? "javascript"}
            </span>
          </div>

          {/* Monaco editor — flex-1 but leaves room for verdict panel */}
          <div className="flex-1 min-h-0">
            {codeInitialized ? (
              <CodeEditor
                value={code}
                onChange={handleCodeChange}
                language={starterCode?.language ?? "javascript"}
                filename={starterCode?.filename ?? "src/charge.js"}
                height="100%"
              />
            ) : (
              <div className="flex h-full items-center justify-center">
                <span className="text-xs font-mono text-neutral-500 animate-pulse">
                  {activeSession ? "Restoring saved code from database..." : "Loading starter code from problem pack..."}
                </span>
              </div>
            )}
          </div>

          {/* Verdict panel — shown below editor after run/submit */}
          {verdictToShow && (
            <VerdictPanel
              result={verdictToShow as RunResult}
              kind={submitResult ? "submit" : "run"}
            />
          )}

          {/* Status bar */}
          <div className="flex items-center justify-between px-4 py-1 bg-[#007acc] shrink-0">
            <span className="text-[10px] font-mono text-white/80">{starterCode?.filename ?? "src/charge.js"}</span>
            <div className="flex items-center gap-4 text-[10px] font-mono text-white/70">
              <span>JavaScript</span>
              {activeSession && <span title={`Session: ${activeSession.id}`}>Session: {activeSession.id.slice(-8)}</span>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
