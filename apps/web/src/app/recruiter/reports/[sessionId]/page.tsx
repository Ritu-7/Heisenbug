"use client";

import { useQuery, useMutation } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  fetchSession,
  fetchSessionEvents,
  fetchSessionSubmissions,
  apiFetch,
} from "@/lib/api";
import { DifficultyBadge } from "@/components/badge";
import { SessionReplay } from "@/components/session-replay";
import { cn } from "@/lib/utils";

async function fetchAICollab(sessionId: string) {
  try {
    const res = await apiFetch<{ ok: boolean; data: any }>(`/api/sessions/${sessionId}/ai-collab`);
    return res.data;
  } catch {
    return null;
  }
}

async function forkSession(sessionId: string, atTimestamp?: string) {
  const res = await apiFetch<{ ok: boolean; data: any }>(`/api/sessions/${sessionId}/fork`, {
    method: "POST",
    body: JSON.stringify(atTimestamp ? { atTimestamp } : {}),
  });
  return res.data;
}

export default function CandidateReportPage({
  params,
}: {
  params: { sessionId: string };
}) {
  const { sessionId } = params;
  const reduce = useReducedMotion();

  // 1. Fetch Session Details
  const sessionQuery = useQuery({
    queryKey: ["session", sessionId],
    queryFn: () => fetchSession(sessionId),
  });

  // 2. Fetch Session Events
  const eventsQuery = useQuery({
    queryKey: ["session-events", sessionId],
    queryFn: () => fetchSessionEvents(sessionId),
    refetchInterval: 10_000,
  });

  // 3. Fetch Submissions
  const submissionsQuery = useQuery({
    queryKey: ["session-submissions", sessionId],
    queryFn: () => fetchSessionSubmissions(sessionId),
  });

  // 4. Fetch AI collaboration signals (purely advisory)
  const aiCollabQuery = useQuery({
    queryKey: ["ai-collab", sessionId],
    queryFn: () => fetchAICollab(sessionId),
  });

  // 5. Fork action state
  const [forkResult, setForkResult] = useState<{ workspaceUrl: string; forkBanner: string } | null>(null);
  const forkMutation = useMutation({
    mutationFn: () => forkSession(sessionId),
    onSuccess: (data) => setForkResult(data),
  });

  const isLoading = sessionQuery.isLoading || eventsQuery.isLoading;
  const isError = sessionQuery.isError || eventsQuery.isError;
  const error = sessionQuery.error || eventsQuery.error;

  if (isLoading) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-10">
        <div className="animate-pulse space-y-4">
          <div className="h-6 w-32 bg-surface-2 rounded" />
          <div className="h-10 w-2/3 bg-surface-2 rounded" />
          <div className="h-24 w-full bg-surface-2 rounded" />
          <div className="h-64 w-full bg-surface-2 rounded" />
        </div>
      </div>
    );
  }

  if (isError || !sessionQuery.data) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-10 space-y-4">
        <div className="rounded-xl border border-fail/40 bg-fail-soft/20 p-6 space-y-2">
          <h2 className="text-base font-semibold text-fail font-mono">Failed to load candidate report</h2>
          <p className="text-xs text-text-secondary font-mono">
            {(error as Error)?.message ?? "Session not found or access forbidden."}
          </p>
        </div>
        <Link
          href="/recruiter/dashboard"
          className="inline-block text-xs text-accent hover:underline font-mono"
        >
          ← Back to Recruiter Dashboard
        </Link>
      </div>
    );
  }

  const session = sessionQuery.data;
  const events = eventsQuery.data ?? [];
  const submissions = submissionsQuery.data ?? [];

  const candidateEmail =
    session.invitation?.candidateEmail ??
    session.user?.email ??
    "Unknown Candidate";
  const assessmentTitle =
    session.invitation?.assessment?.title ?? "Technical Assessment";
  const problem = session.version?.problem;
  const backHref = session.invitation?.assessment?.id
    ? `/recruiter/assessments/${session.invitation.assessment.id}`
    : "/recruiter/dashboard";

  const latestSubmission = submissions[0] ?? session.submissions?.[0];

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 space-y-8" data-testid="candidate-report-page">
      {/* ── Breadcrumb & Top Bar ────────────────────────────────────────── */}
      <motion.div
        initial={reduce ? false : { opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="space-y-1"
      >
        <Link
          href={backHref}
          className="text-xs text-text-secondary hover:text-text font-mono transition-colors"
        >
          ← Back to Assessment
        </Link>

        <div className="flex flex-wrap items-center justify-between gap-4 pt-1">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono text-accent uppercase tracking-wider font-semibold">
                Candidate Technical Report
              </span>
              <span className="text-xs font-mono text-text-secondary">·</span>
              <span className="text-xs font-mono text-text-secondary">
                {assessmentTitle}
              </span>
            </div>
            <h1 className="font-serif text-3xl font-semibold text-text mt-1">
              {candidateEmail}
            </h1>
          </div>

          {/* Status & Problem Info */}
          <div className="flex items-center gap-2">
            {problem?.difficulty && (
              <DifficultyBadge difficulty={problem.difficulty as any} />
            )}
            <span
              className={cn(
                "px-2.5 py-0.5 rounded-full text-xs font-mono font-semibold uppercase border",
                session.status === "SUBMITTED"
                  ? "bg-pass-soft text-pass border-pass/30"
                  : "bg-warning-soft text-warning border-warning/30",
              )}
            >
              {session.status}
            </span>
          </div>
        </div>

        <p className="text-xs font-mono text-text-secondary pt-1">
          Problem: <strong className="text-text">{problem?.title ?? "Challenge"}</strong> (
          {problem?.slug}) · Started:{" "}
          {new Date(session.createdAt).toLocaleString()}
        </p>
      </motion.div>

      {/* ── Submission Result Summary (if submitted) ─────────────────────── */}
      {latestSubmission && (
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
          className="rounded-xl border border-border bg-surface p-5 flex flex-wrap items-center justify-between gap-4"
        >
          <div className="space-y-1">
            <span className="text-xs font-mono text-text-secondary uppercase tracking-wider">
              Final Evaluated Verdict
            </span>
            <div className="flex items-center gap-3">
              <span className="text-3xl font-bold font-mono text-pass">
                {latestSubmission.score}/100
              </span>
              <span className="text-xs font-mono text-text-secondary">
                Submitted on {new Date(latestSubmission.createdAt).toLocaleTimeString()}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {latestSubmission.executionMode && (
              <span
                className={cn(
                  "px-2.5 py-1 rounded-lg border text-xs font-mono font-medium flex items-center gap-1.5",
                  latestSubmission.executionMode === "DOCKER"
                    ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                    : "bg-amber-500/10 text-amber-300 border-amber-500/30",
                )}
              >
                {latestSubmission.executionMode === "DOCKER"
                  ? "🔒 Docker Isolated"
                  : "⚠️ Native (Unisolated)"}
              </span>
            )}
            <span className="px-3 py-1.5 rounded-lg border border-border bg-surface-2 text-xs font-mono text-text">
              {latestSubmission.score === 100 ? "✓ Full marks" : "Evaluated"}
            </span>
            {(latestSubmission.verdictJson as { passed?: boolean })?.passed && (
              <Link
                href={`/postmortems/${sessionId}`}
                className="px-3 py-1.5 rounded-lg border border-pass/30 bg-pass-soft text-xs font-mono text-pass hover:bg-pass-soft/80 transition-colors"
              >
                View postmortem →
              </Link>
            )}
          </div>
        </motion.div>
      )}

      {/* ── AI Collaboration Signals (purely advisory) ────────────────────── */}
      {aiCollabQuery.data && (() => {
        const s = aiCollabQuery.data.signals;
        const labelColors: Record<string, string> = {
          verified_before_using: "text-pass bg-pass-soft border-pass/30",
          adapted_ai_suggestions: "text-accent bg-accent-soft border-accent/30",
          used_without_verification: "text-warning bg-warning-soft border-warning/30",
          no_ai_used: "text-text-secondary bg-surface-2 border-border",
        };
        return (
          <motion.div
            initial={reduce ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, delay: 0.05 }}
            className="rounded-xl border border-border bg-surface p-5 space-y-3"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-mono font-semibold uppercase tracking-wider text-text-secondary">AI Collaboration Signals</h2>
              <span className="text-[10px] font-mono text-text-secondary italic">Advisory only — does not affect verdict</span>
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-3 flex-wrap">
                <span className={cn("px-2.5 py-1 rounded-full text-xs font-mono font-semibold border", labelColors[s.label] ?? "text-text-secondary bg-surface-2 border-border")}>
                  {s.label === "verified_before_using" && "✓ AI: verified before using"}
                  {s.label === "adapted_ai_suggestions" && "↗ AI: adapted suggestions"}
                  {s.label === "used_without_verification" && "⚠ AI: used without verification"}
                  {s.label === "no_ai_used" && "— No AI assistance used"}
                </span>
                {s.usedAIMentor && s.medianMsToNextRun !== null && (
                  <span className="text-xs font-mono text-text-secondary">
                    {s.mentorMessagePairs} exchange{s.mentorMessagePairs !== 1 ? "s" : ""} · median {Math.round(s.medianMsToNextRun / 1000)}s to next run
                  </span>
                )}
              </div>
              <p className="text-xs text-text-secondary font-mono">{s.labelDetail}</p>
              {s.postMentorCodeOriginalityFraction !== null && (
                <p className="text-xs font-mono text-text-secondary">
                  Post-mentor code originality: <span className="text-text font-semibold">{Math.round(s.postMentorCodeOriginalityFraction * 100)}%</span>{" "}
                  ({s.postMentorCodeOriginalityFraction > 0.5 ? "modified significantly" : "near-verbatim"})
                </p>
              )}
            </div>
          </motion.div>
        );
      })()}

      {/* ── Fork Session Action ───────────────────────────────────────────── */}
      <motion.div
        initial={reduce ? false : { opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, delay: 0.1 }}
        className="rounded-xl border border-border bg-surface p-5 space-y-3"
      >
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-xs font-mono font-semibold uppercase tracking-wider text-text-secondary">Fork Session</h2>
            <p className="text-xs text-text-secondary mt-1">Start from this candidate&apos;s latest code. Clearly labeled fork — does not affect candidate stats.</p>
          </div>
          <button
            onClick={() => forkMutation.mutate()}
            disabled={forkMutation.isPending}
            className={cn("px-4 py-2 rounded-lg text-xs font-mono font-semibold transition-colors border shrink-0 border-accent/40 text-accent hover:bg-accent/10 disabled:opacity-50 disabled:cursor-not-allowed")}
          >
            {forkMutation.isPending ? "Forking..." : "⑂ Fork from latest"}
          </button>
        </div>
        {forkResult && (
          <div className="rounded-lg border border-pass/30 bg-pass-soft/20 p-3 space-y-1">
            <p className="text-xs font-mono text-pass font-semibold">✓ Fork created</p>
            <p className="text-xs text-text-secondary font-mono">{forkResult.forkBanner}</p>
            <a href={forkResult.workspaceUrl} className="inline-block text-xs font-mono text-accent hover:underline">Open forked workspace →</a>
          </div>
        )}
        {forkMutation.isError && (
          <p className="text-xs text-fail font-mono">Fork failed: {(forkMutation.error as Error).message}</p>
        )}
      </motion.div>

      {/* ── Interactive Replay Component ─────────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-text-secondary font-mono">
            Candidate Session Replay & Process Analytics
          </h2>
        </div>

        <SessionReplay
          session={session}
          events={events}
          submissions={submissions}
        />
      </section>
    </div>
  );
}
