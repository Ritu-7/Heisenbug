"use client";

import { useQuery, useMutation } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  fetchPostmortem,
  sharePostmortem,
  type PostmortemDoc,
} from "@/lib/api";
import { DifficultyBadge, SkillBadge, TrackBadge } from "@/components/badge";
import { cn } from "@/lib/utils";

// ── Helpers ────────────────────────────────────────────────────────────────

function fmt(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function fmtDuration(ms: number | null): string {
  if (ms === null || ms === undefined) return "—";
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  if (minutes < 60) return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

// ── Diff renderer ──────────────────────────────────────────────────────────

function DiffViewer({ diffText }: { diffText: string }) {
  const lines = diffText.split("\n");
  return (
    <div className="font-mono text-xs leading-5 overflow-x-auto">
      {lines.map((line, i) => {
        const isAdd = line.startsWith("+") && !line.startsWith("+++");
        const isDel = line.startsWith("-") && !line.startsWith("---");
        const isHunk = line.startsWith("@@");
        const isHeader = line.startsWith("---") || line.startsWith("+++") || line.startsWith("diff ");

        return (
          <div
            key={i}
            className={cn(
              "px-3 py-0",
              isAdd && "bg-pass-soft/30 text-pass",
              isDel && "bg-fail-soft/30 text-fail",
              isHunk && "bg-accent-soft/20 text-accent",
              isHeader && "text-text-secondary",
              !isAdd && !isDel && !isHunk && !isHeader && "text-text",
            )}
          >
            <span className="select-none mr-2 text-text-secondary/40 inline-block w-4">
              {isAdd ? "+" : isDel ? "−" : isHunk ? "@" : " "}
            </span>
            {line.startsWith("+") || line.startsWith("-") || line.startsWith("@")
              ? line.slice(1)
              : line}
          </div>
        );
      })}
    </div>
  );
}

// ── Section card ───────────────────────────────────────────────────────────

function Section({
  icon,
  title,
  children,
  delay = 0,
}: {
  icon: string;
  title: string;
  children: React.ReactNode;
  delay?: number;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.section
      initial={reduce ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay }}
      className="rounded-xl border border-border bg-surface overflow-hidden"
    >
      <div className="flex items-center gap-2 px-5 py-3 border-b border-border bg-surface-2">
        <span className="text-base">{icon}</span>
        <h2 className="text-xs font-mono font-semibold uppercase tracking-wider text-text-secondary">
          {title}
        </h2>
      </div>
      <div className="p-5">{children}</div>
    </motion.section>
  );
}

// ── Timeline row ───────────────────────────────────────────────────────────

function TimelineRow({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-start gap-4 py-2 border-b border-border/50 last:border-0">
      <span className="w-36 shrink-0 text-xs font-mono text-text-secondary">{label}</span>
      <span
        className={cn(
          "text-xs font-mono",
          highlight ? "text-accent font-semibold" : "text-text",
        )}
      >
        {value}
      </span>
    </div>
  );
}

// ── Check pill ─────────────────────────────────────────────────────────────

function CheckPill({
  check,
}: {
  check: PostmortemDoc["verdict"]["checks"][0];
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-lg px-3 py-2 border text-xs font-mono",
        check.passed
          ? "border-pass/30 bg-pass-soft/20 text-pass"
          : "border-fail/30 bg-fail-soft/20 text-fail",
      )}
    >
      <span className="shrink-0 font-bold">{check.passed ? "✓" : "✗"}</span>
      <div>
        <span className="font-semibold">{check.id}</span>
        <span className="text-text-secondary ml-2">{check.weight}pt</span>
        {!check.passed && check.message && (
          <p className="mt-0.5 text-[11px] text-fail/80 leading-relaxed">{check.message}</p>
        )}
      </div>
    </div>
  );
}

// ── Share button ───────────────────────────────────────────────────────────

function ShareButton({ sessionId }: { sessionId: string }) {
  const [copied, setCopied] = useState(false);

  const mutation = useMutation({
    mutationFn: () => sharePostmortem(sessionId),
    onSuccess: (data) => {
      navigator.clipboard.writeText(data.shareUrl).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
      });
    },
  });

  return (
    <button
      onClick={() => mutation.mutate()}
      disabled={mutation.isPending}
      className={cn(
        "inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-mono font-semibold transition-all",
        "border border-accent/40 text-accent hover:bg-accent/10",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        copied && "border-pass/40 text-pass bg-pass-soft/20",
      )}
    >
      {mutation.isPending ? (
        <span className="animate-pulse">Generating link…</span>
      ) : copied ? (
        <>
          <span>✓</span> Link copied!
        </>
      ) : (
        <>
          <span>↗</span> Share postmortem
        </>
      )}
    </button>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function PostmortemPage({
  params,
}: {
  params: { sessionId: string };
}) {
  const { sessionId } = params;
  const reduce = useReducedMotion();

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["postmortem", sessionId],
    queryFn: () => fetchPostmortem(sessionId),
    retry: 1,
  });

  if (isLoading) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12 space-y-6">
        <div className="animate-pulse space-y-4">
          <div className="h-5 w-24 bg-surface-2 rounded" />
          <div className="h-10 w-3/4 bg-surface-2 rounded" />
          <div className="h-32 bg-surface-2 rounded-xl" />
          <div className="h-32 bg-surface-2 rounded-xl" />
          <div className="h-48 bg-surface-2 rounded-xl" />
        </div>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12 space-y-4">
        <div className="rounded-xl border border-fail/40 bg-fail-soft/10 p-6">
          <h2 className="text-sm font-mono font-semibold text-fail">
            Postmortem unavailable
          </h2>
          <p className="mt-1 text-xs text-text-secondary font-mono">
            {(error as Error)?.message ??
              "This session either has no passing submission or you don't have access."}
          </p>
        </div>
        <Link
          href="/dashboard"
          className="inline-block text-xs font-mono text-accent hover:underline"
        >
          ← Back to Dashboard
        </Link>
      </div>
    );
  }

  const doc = data;
  const submittedDate = doc.verdict.submittedAt
    ? new Date(doc.verdict.submittedAt).toLocaleDateString(undefined, {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : "Unknown date";

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 space-y-8" data-testid="postmortem-page">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <motion.div
        initial={reduce ? false : { opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22 }}
        className="space-y-2"
      >
        <div className="flex items-center justify-between">
          <Link
            href="/dashboard"
            className="text-xs font-mono text-text-secondary hover:text-text transition-colors"
          >
            ← Back to Dashboard
          </Link>
          <ShareButton sessionId={sessionId} />
        </div>

        <div className="space-y-1 pt-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono text-accent uppercase tracking-wider font-semibold">
              Session Postmortem
            </span>
            <span className="text-xs font-mono text-text-secondary">·</span>
            <span className="text-xs font-mono text-text-secondary">{submittedDate}</span>
          </div>

          <h1 className="font-serif text-3xl font-semibold text-text">
            {doc.problem.title}
          </h1>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <TrackBadge track={doc.problem.track} />
            <DifficultyBadge difficulty={doc.problem.difficulty} />
            {doc.problem.skills.map((s) => (
              <SkillBadge key={s} skill={s} />
            ))}
            <span className="text-xs font-mono text-text-secondary">
              {doc.problem.estMinutes} min estimated
            </span>
          </div>
        </div>

        {/* Score badge */}
        <div className="flex items-center gap-3 pt-2">
          <span
            className={cn(
              "px-4 py-1.5 rounded-full text-sm font-bold font-mono border",
              doc.verdict.passed
                ? "bg-pass-soft text-pass border-pass/30"
                : "bg-fail-soft text-fail border-fail/30",
            )}
          >
            {doc.verdict.passed ? "✓ PASSED" : "✗ FAILED"}
          </span>
          <span className="text-2xl font-bold font-mono text-text">
            {doc.verdict.score}
            <span className="text-sm font-normal text-text-secondary">/100</span>
          </span>
          <span className="text-xs text-text-secondary font-mono">
            submitted {fmtTime(doc.verdict.submittedAt)}
          </span>
        </div>
      </motion.div>

      {/* ── Ticket Summary ───────────────────────────────────────────────── */}
      <Section icon="📋" title="Problem Ticket" delay={0.05}>
        <p className="text-sm text-text leading-relaxed">{doc.problem.ticketSummary}</p>
        <div className="mt-3 flex items-center gap-2">
          <span className="text-xs font-mono text-text-secondary">
            Slug: <code className="text-text">{doc.problem.slug}</code>
          </span>
          <span className="text-xs font-mono text-text-secondary">·</span>
          <Link
            href={`/problems/${doc.problem.slug}`}
            className="text-xs font-mono text-accent hover:underline"
          >
            Open problem →
          </Link>
        </div>
      </Section>

      {/* ── Narrative ────────────────────────────────────────────────────── */}
      <Section icon="📖" title="What Happened" delay={0.1}>
        <div className="space-y-5">
          <div>
            <h3 className="text-xs font-mono font-semibold text-text-secondary uppercase tracking-wider mb-1.5">
              What was broken
            </h3>
            <p className="text-sm text-text leading-relaxed">{doc.narrative.whatBroke}</p>
          </div>

          <div>
            <h3 className="text-xs font-mono font-semibold text-text-secondary uppercase tracking-wider mb-1.5">
              Root cause (editorial)
            </h3>
            <p className="text-sm text-text leading-relaxed">
              {doc.narrative.rootCauseHint || "No editorial content available for this problem version."}
            </p>
          </div>

          <div>
            <h3 className="text-xs font-mono font-semibold text-text-secondary uppercase tracking-wider mb-1.5">
              How long it took
            </h3>
            <p className="text-sm text-text">{doc.narrative.howLongItTook}</p>
          </div>

          <div>
            <h3 className="text-xs font-mono font-semibold text-text-secondary uppercase tracking-wider mb-1.5">
              What was tried
            </h3>
            <p className="text-sm text-text">{doc.narrative.whatWasTried}</p>
          </div>
        </div>
      </Section>

      {/* ── Timeline ─────────────────────────────────────────────────────── */}
      <Section icon="⏱" title="Real Session Timeline" delay={0.15}>
        <div>
          <TimelineRow label="Session opened" value={fmt(doc.timeline.sessionStarted)} />
          <TimelineRow
            label="First code edit"
            value={doc.timeline.firstEdit ? fmt(doc.timeline.firstEdit) : "No edits recorded"}
          />
          <TimelineRow
            label="First test run"
            value={doc.timeline.firstRun ? fmt(doc.timeline.firstRun) : "No runs before submit"}
          />
          <TimelineRow
            label="Final submission"
            value={fmt(doc.verdict.submittedAt)}
            highlight
          />
          <TimelineRow
            label="Active edit time"
            value={fmtDuration(doc.timeline.totalDurationMs)}
          />
          <TimelineRow
            label="Total wall clock"
            value={
              doc.timeline.wallClockMinutes !== null
                ? `${doc.timeline.wallClockMinutes} minutes`
                : "—"
            }
          />
        </div>
      </Section>

      {/* ── Attempts ─────────────────────────────────────────────────────── */}
      <Section icon="🔁" title="Attempts &amp; Hints" delay={0.2}>
        <div className="grid grid-cols-3 gap-4 mb-5">
          <div className="text-center p-3 rounded-lg bg-surface-2 border border-border">
            <div className="text-2xl font-bold font-mono text-text">
              {doc.attempts.runCount}
            </div>
            <div className="text-xs font-mono text-text-secondary">test runs</div>
          </div>
          <div className="text-center p-3 rounded-lg bg-surface-2 border border-border">
            <div className="text-2xl font-bold font-mono text-text">
              {doc.attempts.hintsUsed.length}
            </div>
            <div className="text-xs font-mono text-text-secondary">hints used</div>
          </div>
          <div className="text-center p-3 rounded-lg bg-surface-2 border border-border">
            <div
              className={cn(
                "text-2xl font-bold font-mono",
                doc.attempts.totalPenalty > 0 ? "text-warning" : "text-text",
              )}
            >
              {doc.attempts.totalPenalty > 0 ? `-${doc.attempts.totalPenalty}` : "0"}
            </div>
            <div className="text-xs font-mono text-text-secondary">hint penalty (pts)</div>
          </div>
        </div>

        {doc.attempts.hintsUsed.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-mono text-text-secondary uppercase tracking-wider font-semibold mb-2">
              Hints revealed
            </p>
            {doc.attempts.hintsUsed.map((h) => (
              <div
                key={h.hintIndex}
                className="flex items-start gap-3 p-3 rounded-lg border border-warning/20 bg-warning-soft/10 text-xs font-mono"
              >
                <span className="shrink-0 text-warning font-semibold">
                  Hint {h.hintIndex}
                </span>
                <div className="flex-1">
                  <span className="text-text">{h.description}</span>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-text-secondary">
                      at {fmtTime(h.at)}
                    </span>
                    <span className="text-warning">-{h.penalty} pts</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {doc.attempts.passingRunBeforeSubmit && (
          <p className="mt-4 text-xs font-mono text-pass">
            ✓ At least one run passed all visible tests before final submission.
          </p>
        )}
      </Section>

      {/* ── Verdict Checks ───────────────────────────────────────────────── */}
      <Section icon="🏆" title="Final Verdict — Check Results" delay={0.25}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {doc.verdict.checks.map((check) => (
            <CheckPill key={check.id} check={check} />
          ))}
        </div>
        {doc.verdict.checks.length === 0 && (
          <p className="text-xs font-mono text-text-secondary italic">
            No check details recorded for this submission.
          </p>
        )}
      </Section>

      {/* ── Diff ─────────────────────────────────────────────────────────── */}
      <Section icon="Δ" title="Final Submission Diff" delay={0.3}>
        <p className="text-xs font-mono text-text-secondary mb-3">
          Real unified diff of your final submission against the problem's starter code.
        </p>
        {doc.verdict.diffText ? (
          <div className="rounded-lg overflow-hidden border border-border bg-[#0d0f12]">
            <DiffViewer diffText={doc.verdict.diffText} />
          </div>
        ) : (
          <p className="text-xs font-mono text-text-secondary italic">
            No diff recorded for this submission.
          </p>
        )}
      </Section>

      {/* ── Editorial ────────────────────────────────────────────────────── */}
      {doc.problem.editorial && (
        <Section icon="📚" title="Problem Editorial" delay={0.35}>
          <div className="prose prose-sm prose-invert max-w-none text-text font-sans">
            <pre className="text-xs font-mono whitespace-pre-wrap text-text leading-relaxed">
              {doc.problem.editorial}
            </pre>
          </div>
        </Section>
      )}

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <motion.div
        initial={reduce ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3, delay: 0.4 }}
        className="pt-2 pb-8 border-t border-border flex items-center justify-between text-xs font-mono text-text-secondary"
      >
        <span>
          Postmortem generated {new Date(doc.generatedAt).toLocaleString()} ·{" "}
          <code className="text-text-secondary">{doc.sessionId.slice(-8)}</code>
        </span>
        <ShareButton sessionId={sessionId} />
      </motion.div>
    </div>
  );
}
