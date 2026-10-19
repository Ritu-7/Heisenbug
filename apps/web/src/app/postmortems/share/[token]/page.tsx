"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { fetchPublicPostmortem, type PostmortemDoc } from "@/lib/api";
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
      initial={reduce ? false : { opacity: 0, y: 10 }}
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
      <span className={cn("text-xs font-mono", highlight ? "text-accent font-semibold" : "text-text")}>
        {value}
      </span>
    </div>
  );
}

// ── Main public share page ─────────────────────────────────────────────────

export default function PublicPostmortemPage({
  params,
}: {
  params: { token: string };
}) {
  const { token } = params;
  const reduce = useReducedMotion();

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["postmortem-public", token],
    queryFn: () => fetchPublicPostmortem(token),
    retry: 1,
  });

  if (isLoading) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12 space-y-6">
        <div className="animate-pulse space-y-4">
          <div className="h-5 w-48 bg-surface-2 rounded" />
          <div className="h-10 w-3/4 bg-surface-2 rounded" />
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
          <h2 className="text-sm font-mono font-semibold text-fail">Postmortem not found</h2>
          <p className="mt-1 text-xs text-text-secondary font-mono">
            {(error as Error)?.message ?? "This link is invalid or has expired."}
          </p>
        </div>
        <Link href="/" className="inline-block text-xs font-mono text-accent hover:underline">
          ← Heisenbug home
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
    <div className="mx-auto max-w-3xl px-4 py-10 space-y-8" data-testid="public-postmortem-page">
      {/* ── Public banner ──────────────────────────────────────────────── */}
      <div className="rounded-lg border border-accent/20 bg-accent-soft/10 px-4 py-2 text-xs font-mono text-accent flex items-center gap-2">
        <span>↗</span>
        <span>
          This is a publicly shared postmortem from{" "}
          <strong className="text-text">
            {doc.candidate.name || doc.candidate.email}
          </strong>
          . Read-only.
        </span>
      </div>

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <motion.div
        initial={reduce ? false : { opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22 }}
        className="space-y-2"
      >
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-accent uppercase tracking-wider font-semibold">
            Session Postmortem
          </span>
          <span className="text-xs font-mono text-text-secondary">·</span>
          <span className="text-xs font-mono text-text-secondary">{submittedDate}</span>
        </div>

        <h1 className="font-serif text-3xl font-semibold text-text">{doc.problem.title}</h1>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <TrackBadge track={doc.problem.track} />
          <DifficultyBadge difficulty={doc.problem.difficulty} />
          {doc.problem.skills.map((s) => (
            <SkillBadge key={s} skill={s} />
          ))}
        </div>

        <div className="flex items-center gap-3 pt-2 flex-wrap">
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
          {doc.verdict.executionMode && (
            <span
              className={cn(
                "px-3 py-1 rounded-full text-xs font-mono font-medium border flex items-center gap-1",
                doc.verdict.executionMode === "DOCKER"
                  ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                  : "bg-amber-500/15 text-amber-300 border-amber-500/30",
              )}
            >
              {doc.verdict.executionMode === "DOCKER"
                ? "🔒 Docker Isolated"
                : "⚠️ Native (Unisolated)"}
            </span>
          )}
          <span className="text-2xl font-bold font-mono text-text">
            {doc.verdict.score}
            <span className="text-sm font-normal text-text-secondary">/100</span>
          </span>
        </div>
      </motion.div>

      {/* ── Narrative ────────────────────────────────────────────────────── */}
      <Section icon="📖" title="What Happened" delay={0.05}>
        <div className="space-y-4">
          <div>
            <h3 className="text-xs font-mono font-semibold text-text-secondary uppercase tracking-wider mb-1">
              What was broken
            </h3>
            <p className="text-sm text-text leading-relaxed">{doc.narrative.whatBroke}</p>
          </div>
          <div>
            <h3 className="text-xs font-mono font-semibold text-text-secondary uppercase tracking-wider mb-1">
              Root cause
            </h3>
            <p className="text-sm text-text leading-relaxed">
              {doc.narrative.rootCauseHint || "No editorial available."}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <h3 className="text-xs font-mono font-semibold text-text-secondary uppercase tracking-wider mb-1">
                Time taken
              </h3>
              <p className="text-sm text-text">{doc.narrative.howLongItTook}</p>
            </div>
            <div>
              <h3 className="text-xs font-mono font-semibold text-text-secondary uppercase tracking-wider mb-1">
                What was tried
              </h3>
              <p className="text-sm text-text">{doc.narrative.whatWasTried}</p>
            </div>
          </div>
        </div>
      </Section>

      {/* ── Timeline ─────────────────────────────────────────────────────── */}
      <Section icon="⏱" title="Real Session Timeline" delay={0.1}>
        <TimelineRow label="Session opened" value={fmt(doc.timeline.sessionStarted)} />
        <TimelineRow
          label="First code edit"
          value={doc.timeline.firstEdit ? fmt(doc.timeline.firstEdit) : "No edits recorded"}
        />
        <TimelineRow
          label="First test run"
          value={doc.timeline.firstRun ? fmt(doc.timeline.firstRun) : "No runs before submit"}
        />
        <TimelineRow label="Final submission" value={fmt(doc.verdict.submittedAt)} highlight />
        <TimelineRow label="Active edit time" value={fmtDuration(doc.timeline.totalDurationMs)} />
        <TimelineRow
          label="Total wall clock"
          value={
            doc.timeline.wallClockMinutes !== null
              ? `${doc.timeline.wallClockMinutes} minutes`
              : "—"
          }
        />
      </Section>

      {/* ── Attempt stats ─────────────────────────────────────────────────── */}
      <Section icon="🔁" title="Attempts" delay={0.15}>
        <div className="grid grid-cols-3 gap-4">
          <div className="text-center p-3 rounded-lg bg-surface-2 border border-border">
            <div className="text-2xl font-bold font-mono text-text">{doc.attempts.runCount}</div>
            <div className="text-xs font-mono text-text-secondary">test runs</div>
          </div>
          <div className="text-center p-3 rounded-lg bg-surface-2 border border-border">
            <div className="text-2xl font-bold font-mono text-text">{doc.attempts.hintsUsed.length}</div>
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
            <div className="text-xs font-mono text-text-secondary">hint penalty</div>
          </div>
        </div>
      </Section>

      {/* ── Verdict checks ────────────────────────────────────────────────── */}
      <Section icon="🏆" title="Check Results" delay={0.2}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {doc.verdict.checks.map((check) => (
            <div
              key={check.id}
              className={cn(
                "flex items-start gap-2 rounded-lg px-3 py-2 border text-xs font-mono",
                check.passed
                  ? "border-pass/30 bg-pass-soft/20 text-pass"
                  : "border-fail/30 bg-fail-soft/20 text-fail",
              )}
            >
              <span className="font-bold">{check.passed ? "✓" : "✗"}</span>
              <div>
                <span className="font-semibold">{check.id}</span>
                <span className="text-text-secondary ml-2">{check.weight}pt</span>
                {!check.passed && check.message && (
                  <p className="mt-0.5 text-[11px] text-fail/80">{check.message}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* ── Diff ─────────────────────────────────────────────────────────── */}
      {doc.verdict.diffText && (
        <Section icon="Δ" title="Final Submission Diff" delay={0.25}>
          <div className="rounded-lg overflow-hidden border border-border bg-[#0d0f12]">
            <DiffViewer diffText={doc.verdict.diffText} />
          </div>
        </Section>
      )}

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <motion.div
        initial={reduce ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
        className="pt-2 pb-8 border-t border-border text-center space-y-1"
      >
        <p className="text-xs font-mono text-text-secondary">
          Shared via{" "}
          <Link href="/" className="text-accent hover:underline">
            Heisenbug
          </Link>{" "}
          · Generated {new Date(doc.generatedAt).toLocaleString()}
        </p>
      </motion.div>
    </div>
  );
}
