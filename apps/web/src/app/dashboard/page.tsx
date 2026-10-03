"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useState } from "react";
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

export default function CandidateDashboardPage() {
  const queryClient = useQueryClient();
  const [authed, setAuthed] = useState<boolean>(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Auto-login helper for dev testing if no token is stored yet
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

  // ── 1. Query Sessions from real API ──────────────────────────────────────
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

  // ── 2. Query Recommended Problems from real API ─────────────────────────
  const {
    data: problems = [],
    isLoading: isLoadingProblems,
  } = useQuery({
    queryKey: ["problems"],
    queryFn: fetchProblems,
  });

  // ── 3. Dev Action Mutation: Create Test Session ─────────────────────────
  const createSessionMutation = useMutation({
    mutationFn: async () => {
      // Use the seeded problem's published version ID
      const targetProblem = problems[0];
      const versionId = targetProblem?.currentVersion?.id ?? "cmur7astv00021m2f7e8ll1sy";
      return createSession(versionId, "PRACTICE");
    },
    onSuccess: () => {
      // Invalidate sessions query to refetch instantly
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
  });

  // Find active session if any
  const activeSession = sessions.find((s) => s.status === "ACTIVE");

  // Check if any submissions exist across all sessions
  const submissionsCount = sessions.reduce((acc, s) => acc + (s.submissions?.length ?? 0), 0);
  const hasSubmissions = submissionsCount > 0;

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 space-y-8">
      {/* ── Top Header & Dev Action ── */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-6">
        <div>
          <h1 className="font-serif text-3xl font-semibold text-text tracking-tight">
            Candidate Dashboard
          </h1>
          <p className="mt-1 text-sm text-text-secondary">
            Welcome back, <span className="font-medium text-text">Alice Candidate</span> (
            <code className="font-mono text-xs">alice@heisenbug.dev</code>)
          </p>
        </div>

        {/* Admin/Dev action to create a real session */}
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
      </div>

      {authError && (
        <div className="rounded-lg border border-fail/40 bg-fail-soft px-4 py-3 text-sm text-fail font-mono">
          Auth Error: {authError}
        </div>
      )}

      {/* ── Section: Continue Where You Left Off ── */}
      {/* Strictly rendered ONLY when a real ACTIVE session exists for this user */}
      {activeSession && activeSession.version?.problem && (
        <section aria-labelledby="continue-heading">
          <div className="rounded-xl border-2 border-accent/40 bg-accent-soft/20 p-5 space-y-3">
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold font-mono bg-accent text-white">
                <span className="h-2 w-2 rounded-full bg-white animate-pulse" />
                Active Session
              </span>
              <span className="text-xs text-text-secondary font-mono">
                Started {new Date(activeSession.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
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
        </section>
      )}

      {/* ── Grid: Skill Matrix + Recent Activity ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Skill Radar */}
        <section aria-labelledby="skills-heading">
          <SkillRadar hasData={hasSubmissions} />
        </section>

        {/* Activity & Submissions */}
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
                {sessions.flatMap((s) => s.submissions ?? []).map((sub) => (
                  <div key={sub.id} className="flex items-center justify-between p-3 rounded border border-border bg-surface-2 text-xs font-mono">
                    <span>Submission #{sub.id.slice(-6)}</span>
                    <span className="font-semibold text-pass">Score: {sub.score}/100</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="pt-4 border-t border-border mt-4 flex items-center justify-between text-xs text-text-secondary font-mono">
            <span>Total sessions: {sessions.length}</span>
            <span>Total submissions: {submissionsCount}</span>
          </div>
        </section>
      </div>

      {/* ── Section: Recommended Problems ── */}
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
            {problems.map((problem: Problem) => (
              <Link
                key={problem.id}
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
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
