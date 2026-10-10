"use client";

import dynamic from "next/dynamic";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useState, useCallback, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { useTheme } from "@/lib/use-theme";

import {
  fetchStarterCode,
  fetchUserSessions,
  fetchSession,
  fetchSessionEvents,
  postSessionEvent,
  createSession,
  runSession,
  submitSession,
  loginUser,
  getAuthToken,
  fetchProblemNearMisses,
  type Session,
  type SessionEvent,
  type RunResult,
  type SubmitResult,
  type VerdictCheck,
  type BadPatchNearMiss,
} from "@/lib/api";
import { DifficultyBadge, TrackBadge } from "@/components/badge";
import { cn } from "@/lib/utils";

// Monaco must be dynamically imported to skip SSR
const CodeEditor = dynamic(
  () => import("@/components/code-editor").then((m) => m.CodeEditor),
  { ssr: false },
);

// ── Types ──────────────────────────────────────────────────────────────────

type Tab = "description" | "hints" | "editorial" | "solution" | "submissions" | "near-misses";

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
  { id: "near-misses", label: "Common Near-Misses" },
];

const AUTOSAVE_DELAY_MS = 2000;
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

// ── Sub-components ─────────────────────────────────────────────────────────

function CountdownTimer({ deadline }: { deadline: string }) {
  const reduce = useReducedMotion();
  const [timeLeftMs, setTimeLeftMs] = useState<number>(() => {
    return Math.max(0, new Date(deadline).getTime() - Date.now());
  });

  useEffect(() => {
    // Initial sync
    setTimeLeftMs(Math.max(0, new Date(deadline).getTime() - Date.now()));

    const interval = setInterval(() => {
      const remaining = Math.max(0, new Date(deadline).getTime() - Date.now());
      setTimeLeftMs(remaining);
      if (remaining <= 0) {
        clearInterval(interval);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [deadline]);

  const totalSeconds = Math.floor(timeLeftMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const isExpired = timeLeftMs <= 0;
  const isCritical = !isExpired && timeLeftMs <= 60 * 1000; // <= 1 minute
  const isWarning = !isExpired && timeLeftMs <= 5 * 60 * 1000; // <= 5 minutes

  const formattedTime = isExpired
    ? "00:00"
    : hours > 0
    ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;

  // Pulse animation respecting reduced motion
  const pulseVariants = reduce
    ? undefined
    : isCritical
    ? {
        scale: [1, 1.04, 1],
        opacity: [1, 0.8, 1],
        transition: { duration: 0.9, repeat: Infinity, ease: "easeInOut" as const },
      }
    : isWarning
    ? {
        opacity: [1, 0.72, 1],
        transition: { duration: 1.8, repeat: Infinity, ease: "easeInOut" as const },
      }
    : undefined;

  return (
    <motion.div
      animate={pulseVariants}
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-mono font-semibold transition-colors border select-none",
        isExpired && "bg-fail-soft text-fail border-fail/40",
        isCritical && "bg-fail-soft text-fail border-fail/40",
        !isCritical && isWarning && "bg-warning-soft text-warning border-warning/40",
        !isWarning && !isExpired && "bg-surface-2 text-text border-border",
      )}
      title={isExpired ? "Time limit exceeded" : `Assessment deadline: ${new Date(deadline).toLocaleTimeString()}`}
    >
      <span className="text-xs shrink-0">⏱</span>
      <span>{formattedTime}</span>
      {isExpired && <span className="text-[10px] uppercase font-normal font-sans">(Expired)</span>}
    </motion.div>
  );
}

function TabBar({
  active,
  onSelect,
  isAssessment,
  hasPassed,
}: {
  active: Tab;
  onSelect: (t: Tab) => void;
  isAssessment: boolean;
  hasPassed: boolean;
}) {
  const lockedTabs: Set<Tab> = isAssessment
    ? new Set(["hints", "editorial", "solution", "near-misses"])
    : new Set();

  const visibleTabs = TABS.filter((tab) => {
    if (tab.id === "near-misses") {
      return hasPassed && !isAssessment;
    }
    return true;
  });

  return (
    <div className="flex border-b border-border bg-surface overflow-x-auto shrink-0">
      {visibleTabs.map((tab) => {
        const isLocked = lockedTabs.has(tab.id);
        return (
          <button
            key={tab.id}
            onClick={() => !isLocked && onSelect(tab.id)}
            disabled={isLocked}
            title={isLocked ? "Locked in Assessment Mode" : undefined}
            className={cn(
              "px-4 py-3 text-xs font-medium whitespace-nowrap transition-colors border-b-2 -mb-px inline-flex items-center gap-1.5",
              isLocked && "opacity-40 cursor-not-allowed text-text-secondary hover:text-text-secondary border-transparent",
              !isLocked && active === tab.id && "border-accent text-accent",
              !isLocked && active !== tab.id && "border-transparent text-text-secondary hover:text-text",
            )}
          >
            <span>{tab.label}</span>
            {isLocked && <span className="text-[10px] opacity-75" aria-label="locked">🔒</span>}
            {tab.id === "near-misses" && <span className="text-xs">💡</span>}
          </button>
        );
      })}
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
      prose-pre:bg-surface-2 prose-pre:text-text prose-pre:rounded-lg
      prose-a:text-accent prose-a:no-underline hover:prose-a:underline
      prose-table:text-sm prose-th:text-text-secondary
      prose-strong:text-text prose-blockquote:border-accent/40 prose-blockquote:text-text-secondary">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{md}</ReactMarkdown>
    </div>
  );
}

// ── Verdict panel with staggered animations ────────────────────────────────

function VerdictPanel({
  result,
  kind,
}: {
  result: (RunResult & { confidencePct?: number | null }) | null;
  kind: "run" | "submit";
}) {
  const reduce = useReducedMotion();
  if (!result) return null;

  const totalWeight = result.checks.reduce((sum, c) => sum + c.weight, 0);
  const bannerVariants = {
    hidden:  { opacity: 0, y: kind === "submit" ? 16 : 8 },
    visible: { opacity: 1, y: 0, transition: { duration: kind === "submit" ? 0.28 : 0.2 } },
  };

  return (
    <motion.div
      key={`verdict-${kind}-${result.score}`}
      variants={reduce ? undefined : bannerVariants}
      initial={reduce ? false : "hidden"}
      animate="visible"
      className={cn(
        "border-t px-4 py-3 space-y-2 shrink-0",
        result.passed ? "border-pass/30 bg-pass-soft" : "border-fail/30 bg-fail-soft",
      )}
    >
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

      {/* Real Calibration Comparison */}
      {kind === "submit" && typeof result.confidencePct === "number" && (() => {
        const conf = result.confidencePct;
        const failedChecks = result.checks.filter((c: VerdictCheck) => !c.passed).map((c: VerdictCheck) => c.id);
        const compText =
          failedChecks.length === 0
            ? `You said ${conf}% confident — you scored ${result.score}/${totalWeight}`
            : `You said ${conf}% confident — you scored ${result.score}/${totalWeight}, ${failedChecks.join(" and ")} failed`;

        const scorePct = Math.round((result.score / totalWeight) * 100);
        const diff = conf - scorePct;
        const calibrationLabel =
          diff > 5 ? "Overconfident" : diff < -5 ? "Underconfident" : "Well-calibrated";

        return (
          <div className="flex flex-wrap items-center justify-between gap-2 px-2.5 py-1.5 rounded bg-surface/70 border border-border/60 text-xs font-mono">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-text-secondary text-[11px]">Calibration:</span>
              <span className="text-text font-medium">{compText}</span>
            </div>
            <span
              className={cn(
                "px-2 py-0.5 rounded text-[10px] font-semibold uppercase font-mono border",
                calibrationLabel === "Overconfident" && "bg-warning-soft text-warning border-warning/30",
                calibrationLabel === "Underconfident" && "bg-accent-soft text-accent border-accent/30",
                calibrationLabel === "Well-calibrated" && "bg-pass-soft text-pass border-pass/30",
              )}
            >
              {calibrationLabel}
            </span>
          </div>
        );
      })()}

      {/* Staggered check rows */}
      <div className="space-y-1">
        {result.checks.map((check: VerdictCheck, idx: number) => (
          <motion.div
            key={check.id}
            initial={reduce ? false : { opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{
              duration: 0.16,
              delay: kind === "submit" ? 0.18 + idx * 0.07 : 0.08 + idx * 0.04,
            }}
            className="flex items-start gap-2 text-[11px] font-mono"
          >
            <span className={cn("mt-0.5 shrink-0", check.passed ? "text-pass" : "text-fail")}>
              {check.passed ? "✓" : "✗"}
            </span>
            <span className={check.passed ? "text-pass" : "text-fail"}>
              [{check.id}:{check.weight}pts]
            </span>
            {!check.passed && check.message && (
              <span className="text-fail/80 truncate">{check.message}</span>
            )}
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}

function SubmissionsPanel({ sessionId }: { sessionId: string | null }) {
  const reduce = useReducedMotion();
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
        Click &quot;Submit&quot; to run the full grader and record your verdict.
      </p>
    </div>
  );

  return (
    <div className="p-4 space-y-2">
      <AnimatePresence initial={false}>
        {submissions.map((sub: { id: string; score: number; confidencePct?: number | null; createdAt: string }, idx: number) => (
          <motion.div
            key={sub.id}
            initial={reduce ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18, delay: idx * 0.05 }}
            className="p-3 rounded-lg border border-border bg-surface-2"
          >
            <div className="flex items-center justify-between text-xs font-mono">
              <div className="flex items-center gap-2">
                <span className="text-text-secondary">{new Date(sub.createdAt).toLocaleString()}</span>
                {typeof sub.confidencePct === "number" && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface border border-border text-text-secondary font-mono">
                    {sub.confidencePct}% confident
                  </span>
                )}
              </div>
              <span className={cn("font-semibold", sub.score >= 70 ? "text-pass" : "text-fail")}>
                {sub.score}/100 pts
              </span>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

function NearMissesPanel({ slug }: { slug: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["near-misses", slug],
    queryFn: () => fetchProblemNearMisses(slug),
  });

  if (isLoading) {
    return (
      <div className="p-6 animate-pulse space-y-3">
        <div className="h-6 w-1/3 bg-surface-2 rounded" />
        <div className="h-24 bg-surface-2 rounded" />
      </div>
    );
  }

  if (isError || !data || data.nearMisses.length === 0) {
    return (
      <div className="p-6 text-center text-text-secondary text-sm">
        No near-miss explanations recorded for this problem yet.
      </div>
    );
  }

  return (
    <div className="p-4 space-y-6 overflow-y-auto">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <span className="text-base">💡</span>
          <h3 className="font-serif text-base font-semibold text-text">
            Common Near-Misses & Pitfalls
          </h3>
        </div>
        <p className="text-xs text-text-secondary">
          Real flawed solutions rejected by the validation pipeline, with explanations of which hidden checks catch them.
        </p>
      </div>

      <div className="space-y-4">
        {data.nearMisses.map((patch: BadPatchNearMiss) => (
          <div
            key={patch.id}
            className="rounded-lg border border-border bg-surface-2 p-4 space-y-3"
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-border pb-3">
              <div>
                <h4 className="font-medium text-sm text-text">{patch.title}</h4>
                <p className="text-xs font-mono text-text-secondary mt-0.5">{patch.filename}</p>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-mono font-medium bg-fail-soft text-fail border border-fail/30">
                  {patch.measuredScore}/{patch.maxScore} pts
                </span>
                <span className="text-xs text-text-secondary font-mono">
                  Fails: {patch.failedChecks.join(", ")}
                </span>
              </div>
            </div>

            {/* Real failure pattern aggregate statistic */}
            <div className="rounded border border-accent/20 bg-accent-soft/30 px-3 py-2 flex items-center justify-between text-xs font-mono">
              <span className="text-text-secondary">Failure pattern prevalence:</span>
              <span className="font-semibold text-accent">
                {patch.failureStat.formatted}
              </span>
            </div>

            {/* Explanation Markdown */}
            <div className="text-xs text-text space-y-2">
              <MarkdownContent md={patch.explanation} emptyMessage="No explanation written." />
            </div>

            {/* Code Snippet */}
            {patch.code && (
              <details className="text-xs font-mono rounded bg-surface border border-border p-2">
                <summary className="cursor-pointer text-text-secondary hover:text-text font-sans text-xs">
                  View bad patch code ({patch.filename})
                </summary>
                <pre className="mt-2 p-3 rounded bg-surface-2 overflow-x-auto text-[11px] text-text">
                  <code>{patch.code}</code>
                </pre>
              </details>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Tab content with crossfade ─────────────────────────────────────────────

function TabContent({
  activeTab,
  problem,
  sessionId,
  isAssessment,
  hasPassed,
}: {
  activeTab: Tab;
  problem: ProblemFull;
  sessionId: string | null;
  isAssessment: boolean;
  hasPassed: boolean;
}) {
  const reduce = useReducedMotion();
  const isLocked = isAssessment && (activeTab === "hints" || activeTab === "editorial" || activeTab === "solution");

  return (
    <div className="flex-1 overflow-y-auto relative">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={activeTab}
          initial={reduce ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="h-full"
        >
          {isLocked ? (
            <div className="flex flex-col items-center justify-center h-full p-8 text-center text-text-secondary space-y-3">
              <div className="h-10 w-10 rounded-full bg-surface-2 border border-border flex items-center justify-center text-lg">
                🔒
              </div>
              <h3 className="font-serif text-base font-semibold text-text">Locked in Assessment Mode</h3>
              <p className="text-xs max-w-sm">
                Hints, editorial, and reference solutions are unconditionally disabled during timed assessments.
              </p>
            </div>
          ) : (
            <>
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
                <SubmissionsPanel sessionId={sessionId} />
              )}
              {activeTab === "near-misses" && hasPassed && (
                <NearMissesPanel slug={problem.slug} />
              )}
            </>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

// ── Editor chrome: theme-aware dark/light wrapper ─────────────────────────

function EditorChrome({
  isDark,
  filename,
  language,
  saveStatus,
}: {
  isDark: boolean;
  filename: string;
  language: string;
  saveStatus: "idle" | "saving" | "saved" | "error";
}) {
  const tabBg    = isDark ? "#252526" : "#ececec";
  const editorBg = isDark ? "#1e1e1e" : "#f3f3f3";
  const borderC  = isDark ? "#3c3c3c" : "#e0e0e0";
  const textC    = isDark ? "#d4d4d4" : "#333333";
  const subTextC = isDark ? "#888888" : "#999999";

  return (
    <div
      className="flex items-center shrink-0 border-b"
      style={{ background: tabBg, borderColor: borderC }}
    >
      <div
        className="flex items-center gap-2 px-4 py-2 border-r border-t-2 border-t-accent"
        style={{ background: editorBg, borderRightColor: borderC }}
      >
        <span className="text-xs font-mono" style={{ color: textC }}>{filename}</span>
        {saveStatus === "saving" && (
          <span className="h-1.5 w-1.5 rounded-full bg-warning" title="Unsaved changes" />
        )}
      </div>
      <span className="ml-auto px-3 text-[10px] font-mono" style={{ color: subTextC }}>
        {language}
      </span>
    </div>
  );
}

// ── Workspace Content ──────────────────────────────────────────────────────

function WorkspaceContent({ slug }: { slug: string }) {
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const sessionIdParam = searchParams.get("sessionId");
  const reduce = useReducedMotion();
  const { isDark } = useTheme();

  // Auto-login test user if no token exists
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

  // ── Query: Starter code ───────────────────────────────────────────────
  const { data: starterCode } = useQuery({
    queryKey: ["starter-code", slug],
    queryFn: () => fetchStarterCode(slug),
    staleTime: Infinity,
  });

  // ── Query: Specific session (if passed directly via query param) ──────
  const { data: directSession } = useQuery({
    queryKey: ["session", sessionIdParam],
    queryFn: () => fetchSession(sessionIdParam!),
    enabled: authed && !!sessionIdParam,
  });

  // ── Query: User's sessions ────────────────────────────────────────────
  const { data: sessions = [] } = useQuery({
    queryKey: ["sessions"],
    queryFn: fetchUserSessions,
    enabled: authed,
  });

  const activeSession: Session | undefined =
    directSession ??
    sessions.find(
      (s) =>
        (s.status === "ACTIVE" || s.status === "SUBMITTED") &&
        (s.version?.problem as { slug: string } | undefined)?.slug === slug,
    );

  const isAssessment = activeSession?.mode === "ASSESSMENT";

  // Force away from locked tabs if in assessment mode
  useEffect(() => {
    if (isAssessment && (activeTab === "hints" || activeTab === "editorial" || activeTab === "solution")) {
      setActiveTab("description");
    }
  }, [isAssessment, activeTab]);

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
      setSubmitResult(null);
    },
  });

  // ── Submit mutation ───────────────────────────────────────────────────
  const [showConfidencePrompt, setShowConfidencePrompt] = useState(false);
  const [selectedConfidence, setSelectedConfidence] = useState<number>(80);

  const submitMutation = useMutation({
    mutationFn: (confidence?: number | null) => {
      if (!activeSession?.id) throw new Error("No active session");
      return submitSession(activeSession.id, confidence);
    },
    onSuccess: (data) => {
      setSubmitResult(data);
      setRunResult(null);
      queryClient.invalidateQueries({ queryKey: ["submissions", activeSession?.id] });
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
  });

  // ── Query: Submissions (to determine if candidate has achieved passed: true) ──
  const { data: userSubmissions = [] } = useQuery({
    queryKey: ["submissions", activeSession?.id],
    queryFn: async () => {
      if (!activeSession?.id) return [];
      const res = await fetch(`${API_BASE}/api/sessions/${activeSession.id}/submissions`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("heisenbug_jwt_token")}` },
      });
      const json = await res.json();
      return json.data ?? [];
    },
    enabled: !!activeSession?.id,
  });

  const hasPassed =
    submitResult?.verdict?.passed === true ||
    userSubmissions.some((s: { verdictJson?: { passed?: boolean } }) => s.verdictJson?.passed === true);

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

  const isRunning   = runMutation.isPending;
  const isSubmitting = submitMutation.isPending;
  const verdictToShow = submitResult
    ? {
        ...submitResult.verdict,
        rawOutput: submitResult.rawOutput,
        durationMs: submitResult.durationMs,
        confidencePct: submitResult.submission?.confidencePct,
      }
    : runResult;

  // Editor chrome colors — theme-aware
  const editorBg = isDark ? "#1e1e1e" : "#f3f3f3";
  const statusBarBg = "#007acc"; // VS Code brand blue

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
            {isAssessment && (
              <span className="px-2 py-0.5 rounded text-[10px] font-mono uppercase font-semibold bg-accent-soft text-accent border border-accent/30">
                Assessment
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <SaveStatus status={saveStatus} />

          {/* Assessment Mode countdown & status vs Practice Mode status */}
          {isAssessment && activeSession?.deadline ? (
            <CountdownTimer deadline={activeSession.deadline} />
          ) : activeSession ? (
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

          {/* ▶ Run */}
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

          {/* Submit with inline confidence prompt */}
          <div className="relative">
            <button
              onClick={() => {
                if (!showConfidencePrompt) {
                  setShowConfidencePrompt(true);
                } else {
                  setShowConfidencePrompt(false);
                  submitMutation.mutate(selectedConfidence);
                }
              }}
              disabled={!activeSession || isRunning || isSubmitting}
              className={cn(
                "px-3.5 py-1.5 rounded-md text-xs font-semibold font-mono transition-colors",
                "bg-accent text-white",
                "hover:bg-accent/90",
                "disabled:opacity-40 disabled:cursor-not-allowed",
              )}
            >
              {isSubmitting ? (
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block h-3 w-3 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                  Submitting...
                </span>
              ) : "Submit"}
            </button>

            {/* Inline confidence prompt — optional, not blocking */}
            <AnimatePresence>
              {showConfidencePrompt && !isSubmitting && (
                <motion.div
                  initial={reduce ? false : { opacity: 0, y: -4, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -4, scale: 0.98 }}
                  transition={{ duration: 0.15 }}
                  className="absolute right-0 top-full mt-2 z-50 w-72 rounded-lg border border-border bg-surface p-3 shadow-xl space-y-2.5"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-text font-mono">
                      How confident are you this passes?
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowConfidencePrompt(false)}
                      className="text-text-secondary hover:text-text text-xs p-1 leading-none"
                      aria-label="Close"
                    >
                      ✕
                    </button>
                  </div>

                  {/* 5-button scale */}
                  <div className="grid grid-cols-5 gap-1">
                    {[20, 40, 60, 80, 100].map((pct) => (
                      <button
                        key={pct}
                        type="button"
                        onClick={() => setSelectedConfidence(pct)}
                        className={cn(
                          "py-1.5 px-0.5 rounded text-xs font-mono font-medium border transition-colors",
                          selectedConfidence === pct
                            ? "bg-accent text-white border-accent shadow-sm"
                            : "bg-surface-2 text-text hover:bg-surface border-border",
                        )}
                      >
                        {pct}%
                      </button>
                    ))}
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-border">
                    <button
                      type="button"
                      onClick={() => {
                        setShowConfidencePrompt(false);
                        submitMutation.mutate(null);
                      }}
                      className="text-xs font-mono text-text-secondary hover:text-text underline"
                    >
                      Skip & Submit
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowConfidencePrompt(false);
                        submitMutation.mutate(selectedConfidence);
                      }}
                      className="px-2.5 py-1 rounded text-xs font-semibold font-mono bg-accent text-white hover:bg-accent/90"
                    >
                      Submit ({selectedConfidence}%)
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* Error banners */}
      <AnimatePresence>
        {runMutation.isError && (
          <motion.div
            key="run-error"
            initial={reduce ? false : { opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.15 }}
            className="px-4 py-2 text-xs font-mono text-fail bg-fail-soft border-b border-fail/30 shrink-0 overflow-hidden"
          >
            Run error: {(runMutation.error as Error).message}
          </motion.div>
        )}
        {submitMutation.isError && (
          <motion.div
            key="submit-error"
            initial={reduce ? false : { opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.15 }}
            className="px-4 py-2 text-xs font-mono text-fail bg-fail-soft border-b border-fail/30 shrink-0 overflow-hidden"
          >
            Submit error: {(submitMutation.error as Error).message}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Two-panel layout ── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Left: Description tabs */}
        <div className="w-[44%] flex flex-col border-r border-border min-h-0">
          <TabBar
            active={activeTab}
            onSelect={setActiveTab}
            isAssessment={isAssessment}
            hasPassed={hasPassed}
          />
          <TabContent
            activeTab={activeTab}
            problem={problem}
            sessionId={activeSession?.id ?? null}
            isAssessment={isAssessment}
            hasPassed={hasPassed}
          />
        </div>

        {/* Right: Editor + verdict */}
        <div
          className="flex-1 flex flex-col min-h-0"
          style={{ background: editorBg }}
        >
          {/* File tab bar — theme-aware VS Code chrome */}
          <EditorChrome
            isDark={isDark}
            filename={starterCode?.filename ?? "src/charge.js"}
            language={starterCode?.language ?? "javascript"}
            saveStatus={saveStatus}
          />

          {/* Monaco editor */}
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
                <span
                  className="text-xs font-mono animate-pulse"
                  style={{ color: isDark ? "#888888" : "#999999" }}
                >
                  {activeSession ? "Restoring saved code from database..." : "Loading starter code from problem pack..."}
                </span>
              </div>
            )}
          </div>

          {/* Verdict panel */}
          <AnimatePresence mode="wait">
            {verdictToShow && (
              <VerdictPanel
                key={`${submitResult ? "submit" : "run"}-${verdictToShow.score}`}
                result={verdictToShow as RunResult}
                kind={submitResult ? "submit" : "run"}
              />
            )}
          </AnimatePresence>

          {/* Status bar */}
          <div
            className="flex items-center justify-between px-4 py-1 shrink-0"
            style={{ background: statusBarBg }}
          >
            <span className="text-[10px] font-mono text-white/80">{starterCode?.filename ?? "src/charge.js"}</span>
            <div className="flex items-center gap-4 text-[10px] font-mono text-white/70">
              <span>{isAssessment ? "Mode: Assessment" : "Mode: Practice"}</span>
              {activeSession && <span title={`Session: ${activeSession.id}`}>Session: {activeSession.id.slice(-8)}</span>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main Page with Suspense boundary ──────────────────────────────────────

export default function WorkspacePage({ params }: { params: { slug: string } }) {
  return (
    <Suspense
      fallback={
        <div className="flex h-[calc(100vh-56px)] items-center justify-center">
          <span className="text-sm text-text-secondary font-mono animate-pulse">
            Loading workspace...
          </span>
        </div>
      }
    >
      <WorkspaceContent slug={params.slug} />
    </Suspense>
  );
}
