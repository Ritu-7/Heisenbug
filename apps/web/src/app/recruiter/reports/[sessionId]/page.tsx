"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import {
  fetchSession,
  fetchSessionEvents,
  fetchSessionSubmissions,
} from "@/lib/api";
import { DifficultyBadge } from "@/components/badge";
import { SessionReplay } from "@/components/session-replay";
import { cn } from "@/lib/utils";

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

          <div className="flex items-center gap-2">
            <span className="px-3 py-1.5 rounded-lg border border-border bg-surface-2 text-xs font-mono text-text">
              {latestSubmission.score === 100 ? "✓ Full marks" : "Evaluated"}
            </span>
          </div>
        </motion.div>
      )}

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
