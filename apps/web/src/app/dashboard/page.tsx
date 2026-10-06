"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useState, useRef } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import {
  fetchUserSessions,
  fetchProblems,
  createSession,
  loginUser,
  getAuthToken,
  type Session,
  type Problem,
} from "@/lib/api";
import { DifficultyBadge, SkillBadge, TrackBadge } from "@/components/badge";
import { SkillRadar } from "@/components/skill-radar";
import { cn } from "@/lib/utils";

// ── Animated number counter ────────────────────────────────────────────────

function useCountUp(target: number, duration = 800): number {
  const [value, setValue] = useState(0);
  const reduce = useReducedMotion();

  useEffect(() => {
    if (reduce || target === 0) {
      setValue(target);
      return;
    }
    const start = performance.now();
    let raf: number;

    function step(now: number) {
      const progress = Math.min((now - start) / duration, 1);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(eased * target));
      if (progress < 1) raf = requestAnimationFrame(step);
    }

    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, duration, reduce]);

  return value;
}

// ── Stat card ──────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  delay = 0,
}: {
  label: string;
  value: number;
  delay?: number;
}) {
  const reduce = useReducedMotion();
  const displayed = useCountUp(value, 700);

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay }}
      className="bg-surface rounded-lg border border-border p-4 flex flex-col gap-1"
    >
      <span className="text-2xl font-bold font-mono text-text">{displayed}</span>
      <span className="text-xs text-text-secondary font-mono">{label}</span>
    </motion.div>
  );
}

// ── Animated submission row ────────────────────────────────────────────────

function SubmissionRow({
  id,
  score,
  index,
}: {
  id: string;
  score: number;
  index: number;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      key={id}
      initial={reduce ? false : { opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.2, delay: index * 0.05 }}
      className="flex items-center justify-between p-3 rounded border border-border bg-surface-2 text-xs font-mono"
    >
      <span>Submission #{id.slice(-6)}</span>
      <span className="font-semibold text-pass">Score: {score}/100</span>
    </motion.div>
  );
}

// ── Animated problem card ──────────────────────────────────────────────────

function ProblemCard({ problem, index }: { problem: Problem; index: number }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, delay: 0.1 + index * 0.06 }}
    >
      <Link
        href={`/problems/${problem.slug}`}
        className="flex items-center justify-between p-4 rounded-lg border border-border bg-surface hover:border-accent/40 transition-colors group"
      >
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-text group-hover:text-accent transition-colors">
              {problem.title}
            </span>
            <TrackBadge track={problem.track} />
          </div>
          <div className="flex flex-wrap gap-1">
            {problem.skills.map((skill) => (
              <SkillBadge key={skill} skill={skill} />
            ))}
          </div>
        </div>
        <div className="flex items-center gap-4">
          <DifficultyBadge difficulty={problem.difficulty} />
          <span className="text-xs text-text-secondary font-mono hidden sm:inline">
            {problem.estMinutes} min
          </span>
        </div>
      </Link>
    </motion.div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function CandidateDashboardPage() {
  const queryClient = useQueryClient();
  const [authed, setAuthed] = useState<boolean>(false);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    async function initAuth() {
      if (getAuthToken()) {
        setAuthed(true);
        return;
      }
      try {
        await loginUser("alice@heisenbug.dev", "testcandidate123");
        setAuthed(true);
      } catch (err) {
        setAuthError((err as Error).message);
      }
    }
    initAuth();
  }, []);

  const {
    data: sessions = [],
    isLoading: isLoadingSessions,
    isError: isErrorSessions,
    error: errorSessions,
  } = useQuery({
    queryKey: ["sessions"],
    queryFn: fetchUserSessions,
    enabled: authed,
  });

  const { data: problems = [], isLoading: isLoadingProblems } = useQuery({
    queryKey: ["problems"],
    queryFn: fetchProblems,
  });

  const createSessionMutation = useMutation({
    mutationFn: async () => {
      const targetProblem = problems[0];
      const versionId = targetProblem?.currentVersion?.id ?? "cmur7astv00021m2f7e8ll1sy";
      return createSession(versionId, "PRACTICE");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
  });

  const activeSession = sessions.find((s) => s.status === "ACTIVE");
  const submissionsCount = sessions.reduce((acc, s) => acc + (s.submissions?.length ?? 0), 0);
  const hasSubmissions = submissionsCount > 0;
  const reduce = useReducedMotion();

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 space-y-8">
      {/* ── Top Header ── */}
      <motion.div
        initial={reduce ? false : { opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22 }}
        className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-6"
      >
        <div>
          <h1 className="font-serif text-3xl font-semibold text-text tracking-tight">
            Candidate Dashboard
          </h1>
          <p className="mt-1 text-sm text-text-secondary">
            Welcome back, <span className="font-medium text-text">Alice Candidate</span> (
            <code className="font-mono text-xs">alice@heisenbug.dev</code>)
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => createSessionMutation.mutate()}
            disabled={createSessionMutation.isPending || !problems.length}
            className={cn(
              "inline-flex items-center gap-2 px-3.5 py-2 rounded-md text-xs font-semibold font-mono shadow-sm",
              "bg-accent text-white hover:bg-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
              "disabled:opacity-50 disabled:cursor-not-allowed transition-colors",
            )}
          >
            {createSessionMutation.isPending ? (
              <span>Creating session...</span>
            ) : (
              <>
                <span className="text-sm">+</span> Create test session
              </>
            )}
          </button>
        </div>
      </motion.div>

      {authError && (
        <div className="rounded-lg border border-fail/40 bg-fail-soft px-4 py-3 text-sm text-fail font-mono">
          Auth Error: {authError}
        </div>
      )}

      {/* ── Stat strip — only once real data arrives ── */}
      {!isLoadingSessions && authed && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="Total sessions" value={sessions.length} delay={0} />
          <StatCard label="Total submissions" value={submissionsCount} delay={0.06} />
          <StatCard
            label="Active sessions"
            value={sessions.filter((s) => s.status === "ACTIVE").length}
            delay={0.12}
          />
          <StatCard
            label="Problems available"
            value={problems.length}
            delay={0.18}
          />
        </div>
      )}

      {/* ── Active session banner ── */}
      <AnimatePresence>
        {activeSession && activeSession.version?.problem && (
          <motion.section
            key="active-session"
            initial={reduce ? false : { opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.97 }}
            transition={{ duration: 0.2 }}
            aria-labelledby="continue-heading"
          >
            <div className="rounded-xl border-2 border-accent/40 bg-accent-soft/20 p-5 space-y-3">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold font-mono bg-accent text-white">
                  <span className="h-2 w-2 rounded-full bg-white animate-pulse" />
                  Active Session
                </span>
                <span className="text-xs text-text-secondary font-mono">
                  Started {new Date(activeSession.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 id="continue-heading" className="text-lg font-bold text-text">
                    {activeSession.version.problem.title}
                  </h2>
                  <div className="mt-1 flex items-center gap-2">
                    <TrackBadge track={activeSession.version.problem.track} />
                    <DifficultyBadge difficulty={activeSession.version.problem.difficulty} />
                    <span className="text-xs text-text-secondary font-mono">
                      Mode: {activeSession.mode}
                    </span>
                  </div>
                </div>

                <Link
                  href={`/problems/${activeSession.version.problem.slug}`}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-xs font-semibold bg-accent text-white hover:bg-accent/90 transition-colors"
                >
                  Continue Session →
                </Link>
              </div>
            </div>
          </motion.section>
        )}
      </AnimatePresence>

      {/* ── Skill Radar + Recent Activity ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <section aria-labelledby="skills-heading">
          <SkillRadar hasData={hasSubmissions} />
        </section>

        <section aria-labelledby="activity-heading" className="flex flex-col justify-between p-5 bg-surface rounded-lg border border-border">
          <div>
            <h3 id="activity-heading" className="text-xs font-semibold uppercase tracking-wider text-text-secondary mb-4 font-mono">
              Recent Submissions
            </h3>

            {isLoadingSessions ? (
              <div className="animate-pulse space-y-2">
                <div className="h-12 bg-surface-2 rounded" />
              </div>
            ) : isErrorSessions ? (
              <p className="text-xs text-fail font-mono">{(errorSessions as Error).message}</p>
            ) : !hasSubmissions ? (
              <div className="py-10 text-center text-text-secondary space-y-2">
                <div className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-surface-2 text-text-secondary text-sm font-mono">
                  0
                </div>
                <p className="text-sm font-medium text-text">No submissions yet</p>
                <p className="text-xs text-text-secondary max-w-xs mx-auto">
                  Start your first problem to record code submissions and test verdicts.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <AnimatePresence initial={false}>
                  {sessions.flatMap((s) => s.submissions ?? []).map((sub, idx) => (
                    <SubmissionRow key={sub.id} id={sub.id} score={sub.score} index={idx} />
                  ))}
                </AnimatePresence>
              </div>
            )}
          </div>

          <div className="pt-4 border-t border-border mt-4 flex items-center justify-between text-xs text-text-secondary font-mono">
            <span>Total sessions: {sessions.length}</span>
            <span>Total submissions: {submissionsCount}</span>
          </div>
        </section>
      </div>

      {/* ── Recommended Problems ── */}
      <section aria-labelledby="recommended-heading" className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 id="recommended-heading" className="text-sm font-semibold uppercase tracking-wider text-text-secondary font-mono">
            Recommended Problems ({problems.length})
          </h2>
          <Link href="/" className="text-xs text-accent font-mono hover:underline">
            View full catalogue →
          </Link>
        </div>

        {isLoadingProblems ? (
          <div className="h-16 bg-surface-2 animate-pulse rounded-lg border border-border" />
        ) : (
          <div className="space-y-2">
            {problems.map((problem: Problem, idx: number) => (
              <ProblemCard key={problem.id} problem={problem} index={idx} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
