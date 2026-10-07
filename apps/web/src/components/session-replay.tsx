"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { type Session, type SessionEvent, type Submission } from "@/lib/api";
import { cn } from "@/lib/utils";

// ── Types & Helpers ────────────────────────────────────────────────────────

export type EventCategory = "edit" | "run" | "hint" | "submit" | "other";

export interface NormalizedEvent {
  raw: SessionEvent;
  index: number;
  category: EventCategory;
  title: string;
  summary: string;
  timestamp: string;
  relativeTime: string;
  elapsedMs: number;
  markerColor: string;
  badgeClass: string;
  passed?: boolean;
  score?: number;
  checks?: Array<{ id: string; weight?: number; passed: boolean; message?: string }>;
}

export interface DerivedProcessMetrics {
  timeToFirstRunMs: number | null;
  timeToFirstRunFormatted: string;
  runsBeforeFinalSubmit: number;
  totalRuns: number;
  totalEdits: number;
  totalHints: number;
  finalScore: number | null;
  totalDurationFormatted: string;
}

function formatDuration(ms: number): string {
  if (ms < 0) ms = 0;
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

function formatRelative(ms: number): string {
  if (ms < 0) ms = 0;
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `+${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

export function normalizeEvent(
  event: SessionEvent,
  index: number,
  sessionStartTime: number,
): NormalizedEvent {
  const type = event.type.toUpperCase();
  const payload = (event.payloadJson ?? {}) as Record<string, any>;
  const eventTime = new Date(event.occurredAt).getTime();
  const elapsedMs = Math.max(0, eventTime - sessionStartTime);

  const timestamp = new Date(event.occurredAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const relativeTime = formatRelative(elapsedMs);

  let category: EventCategory = "other";
  let title = "Event";
  let summary = "Session event recorded";
  let markerColor = "bg-surface-3 border-border";
  let badgeClass = "bg-surface-2 text-text-secondary border-border";
  let passed: boolean | undefined = undefined;
  let score: number | undefined = undefined;
  let checks: NormalizedEvent["checks"] = undefined;

  // 1. EDIT
  if (type === "CODE_SAVE" || type === "EDIT" || type === "FILE_EDIT") {
    category = "edit";
    title = "Edit";
    markerColor = "bg-sky-400 border-sky-300 ring-sky-400/30";
    badgeClass = "bg-sky-500/15 text-sky-400 border-sky-500/30";

    if (payload.summary) {
      summary = `Edit — ${payload.summary}`;
    } else if (payload.lines !== undefined) {
      summary = `Edit — Code saved (${payload.lines} lines)`;
    } else if (typeof payload.code === "string") {
      const lineCount = payload.code.split("\n").length;
      summary = `Edit — Code snapshot saved (${lineCount} lines)`;
    } else {
      summary = "Edit — Code modified and autosaved";
    }
  }

  // 2. RUN
  else if (type === "RUN" || type === "RUN_COMPLETED" || type === "RUN_STARTED") {
    category = "run";
    title = "Run";
    passed = payload.passed;
    score = payload.score;
    checks = Array.isArray(payload.checks) ? payload.checks : undefined;

    if (type === "RUN_STARTED") {
      summary = "Run started — Visible tests executing...";
      markerColor = "bg-amber-400/70 border-amber-300 ring-amber-400/20";
      badgeClass = "bg-amber-500/10 text-amber-300 border-amber-500/20";
    } else {
      const isPassed = Boolean(passed || (checks && checks.length > 0 && checks.every((c) => c.passed)));
      passed = isPassed;

      if (isPassed) {
        markerColor = "bg-emerald-400 border-emerald-300 ring-emerald-400/30";
        badgeClass = "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
      } else {
        markerColor = "bg-amber-500 border-amber-400 ring-amber-500/30";
        badgeClass = "bg-amber-500/15 text-amber-400 border-amber-500/30";
      }

      if (checks && checks.length > 0) {
        const passedCount = checks.filter((c) => c.passed).length;
        summary = `Run — ${passedCount}/${checks.length} visible tests passed${score !== undefined ? ` (${score} pts)` : ""}`;
      } else if (passed !== undefined) {
        summary = `Run — ${passed ? "Passed" : "Failed"}${score !== undefined ? ` (${score} pts)` : ""}`;
      } else if (score !== undefined) {
        summary = `Run — Score: ${score} pts`;
      } else {
        summary = "Run — Visible test suite executed";
      }
    }
  }

  // 3. HINT
  else if (type === "HINT" || type === "HINT_REVEAL" || type === "HINT_USE") {
    category = "hint";
    title = "Hint";
    markerColor = "bg-purple-400 border-purple-300 ring-purple-400/30";
    badgeClass = "bg-purple-500/15 text-purple-400 border-purple-500/30";

    const hintNum = payload.hintIndex ?? 1;
    const penalty = payload.penalty !== undefined ? ` (-${payload.penalty} pts)` : "";
    if (payload.description) {
      summary = payload.description.startsWith("Hint")
        ? payload.description
        : `Hint — ${payload.description}`;
    } else {
      summary = `Hint ${hintNum} revealed${penalty}`;
    }
  }

  // 4. SUBMIT
  else if (type === "SUBMIT" || type === "SUBMIT_COMPLETED" || type === "SUBMISSION") {
    category = "submit";
    title = "Submit";
    score = payload.score;
    passed = payload.passed;
    checks = Array.isArray(payload.checks) ? payload.checks : undefined;
    markerColor = "bg-emerald-500 border-emerald-300 ring-emerald-500/40";
    badgeClass = "bg-emerald-500/20 text-emerald-300 border-emerald-500/40";

    if (score !== undefined) {
      const allPassed = passed || score === 100;
      summary = `Submit — ${score}/100${allPassed ? " (All tests passed)" : ""}`;
    } else {
      summary = "Submit — Final solution submitted";
    }
  }

  return {
    raw: event,
    index,
    category,
    title,
    summary,
    timestamp,
    relativeTime,
    elapsedMs,
    markerColor,
    badgeClass,
    passed,
    score,
    checks,
  };
}

export function deriveProcessMetrics(
  events: SessionEvent[],
  session: Session,
  submissions?: Submission[],
): DerivedProcessMetrics {
  const sessionStartTime = Math.min(
    new Date(session.createdAt).getTime(),
    events.length > 0 ? new Date(events[0].occurredAt).getTime() : Date.now(),
  );

  // 1. Time to first test run
  const firstRunEvent = events.find(
    (e) =>
      e.type === "RUN" ||
      e.type === "RUN_STARTED" ||
      e.type === "RUN_COMPLETED",
  );

  let timeToFirstRunMs: number | null = null;
  let timeToFirstRunFormatted = "N/A (No runs)";
  if (firstRunEvent) {
    timeToFirstRunMs = Math.max(0, new Date(firstRunEvent.occurredAt).getTime() - sessionStartTime);
    timeToFirstRunFormatted = formatDuration(timeToFirstRunMs);
  }

  // 2. Number of runs before final submit
  let lastSubmitIndex = -1;
  for (let i = events.length - 1; i >= 0; i--) {
    const t = events[i].type.toUpperCase();
    if (t === "SUBMIT" || t === "SUBMIT_COMPLETED" || t === "SUBMISSION") {
      lastSubmitIndex = i;
      break;
    }
  }

  const eventsBeforeSubmit = lastSubmitIndex >= 0 ? events.slice(0, lastSubmitIndex) : events;
  const completedRunsBefore = eventsBeforeSubmit.filter(
    (e) => e.type === "RUN_COMPLETED" || e.type === "RUN",
  ).length;
  const startedRunsBefore = eventsBeforeSubmit.filter(
    (e) => e.type === "RUN_STARTED",
  ).length;
  const runsBeforeFinalSubmit = completedRunsBefore > 0 ? completedRunsBefore : startedRunsBefore;

  // Additional metrics
  const totalCompletedRuns = events.filter(
    (e) => e.type === "RUN_COMPLETED" || e.type === "RUN",
  ).length;
  const totalStartedRuns = events.filter((e) => e.type === "RUN_STARTED").length;
  const totalRuns = totalCompletedRuns > 0 ? totalCompletedRuns : totalStartedRuns;

  const totalEdits = events.filter(
    (e) => e.type === "CODE_SAVE" || e.type === "EDIT" || e.type === "FILE_EDIT",
  ).length;

  const totalHints = events.filter(
    (e) => e.type === "HINT" || e.type === "HINT_REVEAL" || e.type === "HINT_USE",
  ).length;

  // Final score
  let finalScore: number | null = null;
  if (submissions && submissions.length > 0) {
    finalScore = submissions[0].score;
  } else {
    const submitEv = events.find((e) => e.type === "SUBMIT" || e.type === "SUBMISSION");
    if (submitEv && (submitEv.payloadJson as any)?.score !== undefined) {
      finalScore = (submitEv.payloadJson as any).score;
    }
  }

  const lastEventTime =
    events.length > 0
      ? new Date(events[events.length - 1].occurredAt).getTime()
      : sessionStartTime;
  const totalDurationFormatted = formatDuration(Math.max(0, lastEventTime - sessionStartTime));

  return {
    timeToFirstRunMs,
    timeToFirstRunFormatted,
    runsBeforeFinalSubmit,
    totalRuns,
    totalEdits,
    totalHints,
    finalScore,
    totalDurationFormatted,
  };
}

// ── Main Replay Component ──────────────────────────────────────────────────

interface SessionReplayProps {
  session: Session;
  events: SessionEvent[];
  submissions?: Submission[];
  className?: string;
}

export function SessionReplay({
  session,
  events,
  submissions,
  className,
}: SessionReplayProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<1 | 2>(1);
  const [categoryFilter, setCategoryFilter] = useState<EventCategory | "all">("all");

  const listContainerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);

  const sessionStartTime = useMemo(() => {
    return Math.min(
      new Date(session.createdAt).getTime(),
      events.length > 0 ? new Date(events[0].occurredAt).getTime() : Date.now(),
    );
  }, [session.createdAt, events]);

  const normalizedEvents = useMemo(() => {
    return events.map((ev, idx) => normalizeEvent(ev, idx, sessionStartTime));
  }, [events, sessionStartTime]);

  const metrics = useMemo(() => {
    return deriveProcessMetrics(events, session, submissions);
  }, [events, session, submissions]);

  // Keep selectedIndex in bounds
  const clampedIndex = Math.min(Math.max(0, selectedIndex), Math.max(0, normalizedEvents.length - 1));
  const activeEvent = normalizedEvents[clampedIndex] ?? null;

  // Filtered event indices
  const filteredEvents = useMemo(() => {
    if (categoryFilter === "all") return normalizedEvents;
    return normalizedEvents.filter((e) => e.category === categoryFilter);
  }, [normalizedEvents, categoryFilter]);

  // Auto-playback loop
  useEffect(() => {
    if (!isPlaying || normalizedEvents.length <= 1) return;

    const intervalMs = playbackSpeed === 1 ? 1600 : 800;
    const interval = setInterval(() => {
      setSelectedIndex((prev) => {
        if (prev >= normalizedEvents.length - 1) {
          setIsPlaying(false);
          return prev;
        }
        return prev + 1;
      });
    }, intervalMs);

    return () => clearInterval(interval);
  }, [isPlaying, playbackSpeed, normalizedEvents.length]);

  // Scroll active event into view in list
  useEffect(() => {
    const el = itemRefs.current[clampedIndex];
    if (el && listContainerRef.current) {
      el.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [clampedIndex]);

  if (events.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-surface p-8 text-center text-text-secondary">
        <p className="text-sm font-medium text-text">No session events recorded yet.</p>
        <p className="text-xs mt-1">Candidate activity will appear here in real time as actions occur.</p>
      </div>
    );
  }

  const scrubberProgress =
    normalizedEvents.length > 1
      ? (clampedIndex / (normalizedEvents.length - 1)) * 100
      : 0;

  return (
    <div className={cn("space-y-6", className)} data-testid="session-replay">
      {/* ── Key Process Metrics Cards ───────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="rounded-xl border border-border bg-surface p-4 flex flex-col justify-between">
          <span className="text-xs font-mono text-text-secondary">Time to First Run</span>
          <span className="text-2xl font-bold font-mono text-text mt-1" data-testid="metric-first-run">
            {metrics.timeToFirstRunFormatted}
          </span>
          <span className="text-[11px] text-text-secondary font-mono mt-1">Initial planning phase</span>
        </div>

        <div className="rounded-xl border border-border bg-surface p-4 flex flex-col justify-between">
          <span className="text-xs font-mono text-text-secondary">Runs Before Final Submit</span>
          <span className="text-2xl font-bold font-mono text-accent mt-1" data-testid="metric-runs-before-submit">
            {metrics.runsBeforeFinalSubmit}
          </span>
          <span className="text-[11px] text-text-secondary font-mono mt-1">Verification iterations</span>
        </div>

        <div className="rounded-xl border border-border bg-surface p-4 flex flex-col justify-between">
          <span className="text-xs font-mono text-text-secondary">Total Edits Recorded</span>
          <span className="text-2xl font-bold font-mono text-text mt-1">
            {metrics.totalEdits}
          </span>
          <span className="text-[11px] text-text-secondary font-mono mt-1">Code modification steps</span>
        </div>

        <div className="rounded-xl border border-border bg-surface p-4 flex flex-col justify-between">
          <span className="text-xs font-mono text-text-secondary">Final Score & Duration</span>
          <span className="text-2xl font-bold font-mono text-pass mt-1">
            {metrics.finalScore !== null ? `${metrics.finalScore}/100` : "In Progress"}
          </span>
          <span className="text-[11px] text-text-secondary font-mono mt-1">
            Total span: {metrics.totalDurationFormatted}
          </span>
        </div>
      </div>

      {/* ── Replay Scrubber Container ───────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-surface p-5 space-y-5 shadow-sm">
        {/* Controls & Timestamp header */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-4">
          <div className="flex items-center gap-2">
            {/* Step back */}
            <button
              onClick={() => {
                setIsPlaying(false);
                setSelectedIndex((prev) => Math.max(0, prev - 1));
              }}
              disabled={clampedIndex === 0}
              className="p-1.5 rounded-lg border border-border hover:bg-surface-2 disabled:opacity-40 transition-colors text-xs font-mono text-text"
              title="Previous event (Left Arrow)"
              aria-label="Previous event"
            >
              ◀ Prev
            </button>

            {/* Play / Pause */}
            <button
              onClick={() => setIsPlaying(!isPlaying)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-mono font-semibold transition-colors flex items-center gap-1.5",
                isPlaying
                  ? "bg-warning text-black hover:bg-warning/90"
                  : "bg-accent text-white hover:bg-accent/90",
              )}
              title={isPlaying ? "Pause replay" : "Play replay"}
            >
              {isPlaying ? "⏸ Pause" : "▶ Replay"}
            </button>

            {/* Step forward */}
            <button
              onClick={() => {
                setIsPlaying(false);
                setSelectedIndex((prev) => Math.min(normalizedEvents.length - 1, prev + 1));
              }}
              disabled={clampedIndex >= normalizedEvents.length - 1}
              className="p-1.5 rounded-lg border border-border hover:bg-surface-2 disabled:opacity-40 transition-colors text-xs font-mono text-text"
              title="Next event (Right Arrow)"
              aria-label="Next event"
            >
              Next ▶
            </button>

            {/* Speed toggle */}
            <button
              onClick={() => setPlaybackSpeed((s) => (s === 1 ? 2 : 1))}
              className="ml-1 px-2 py-1 rounded border border-border text-[11px] font-mono text-text-secondary hover:text-text hover:bg-surface-2 transition-colors"
            >
              {playbackSpeed}x
            </button>
          </div>

          {/* Current Event Counter & Real Timestamps */}
          {activeEvent && (
            <div className="flex items-center gap-3 text-xs font-mono">
              <span className="text-text-secondary">
                Step <strong className="text-text">{clampedIndex + 1}</strong> of{" "}
                {normalizedEvents.length}
              </span>
              <span className="px-2 py-0.5 rounded bg-surface-2 border border-border text-text">
                {activeEvent.timestamp}
              </span>
              <span className="text-accent font-semibold">{activeEvent.relativeTime}</span>
            </div>
          )}
        </div>

        {/* ── Interactive Horizontal Scrubber Track ──────────────────────── */}
        <div className="space-y-3 pt-1">
          <div className="relative w-full py-4 px-2">
            {/* Background Track Line */}
            <div className="relative h-2 w-full rounded-full bg-surface-2 border border-border overflow-hidden">
              <div
                className="h-full bg-accent/60 transition-all duration-150 rounded-full"
                style={{ width: `${scrubberProgress}%` }}
              />
            </div>

            {/* Interactive Range Input Overlay */}
            <input
              type="range"
              min={0}
              max={Math.max(0, normalizedEvents.length - 1)}
              value={clampedIndex}
              onChange={(e) => {
                setIsPlaying(false);
                setSelectedIndex(Number(e.target.value));
              }}
              aria-label="Timeline scrubber"
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-20"
            />

            {/* Markers on the track */}
            <div className="absolute inset-x-2 top-1/2 -translate-y-1/2 pointer-events-none z-10">
              {normalizedEvents.map((evt, idx) => {
                const percent =
                  normalizedEvents.length > 1
                    ? (idx / (normalizedEvents.length - 1)) * 100
                    : 50;
                const isSelected = idx === clampedIndex;

                return (
                  <button
                    key={evt.raw.id}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setIsPlaying(false);
                      setSelectedIndex(idx);
                    }}
                    style={{ left: `${percent}%` }}
                    className={cn(
                      "pointer-events-auto absolute top-1/2 -translate-x-1/2 -translate-y-1/2 transition-all transform group",
                      isSelected
                        ? "scale-125 z-30"
                        : "hover:scale-110 opacity-80 hover:opacity-100 z-10",
                    )}
                    title={`#${idx + 1} ${evt.title} (${evt.relativeTime}): ${evt.summary}`}
                  >
                    <span
                      className={cn(
                        "block h-3.5 w-3.5 rounded-full border-2 transition-all shadow-sm",
                        evt.markerColor,
                        isSelected ? "ring-4 ring-accent/40 shadow-lg scale-110" : "",
                      )}
                    />
                    {/* Tooltip on hover */}
                    <span className="opacity-0 group-hover:opacity-100 pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-surface-3 border border-border text-[10px] font-mono text-text whitespace-nowrap rounded shadow-lg transition-opacity z-40">
                      {evt.summary}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Legend & Category Filters */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-[11px] font-mono">
            <div className="flex items-center gap-1.5">
              <span className="text-text-secondary mr-1">Filter:</span>
              {(["all", "edit", "run", "hint", "submit"] as const).map((cat) => (
                <button
                  key={cat}
                  onClick={() => setCategoryFilter(cat)}
                  className={cn(
                    "px-2 py-0.5 rounded capitalize transition-colors border",
                    categoryFilter === cat
                      ? "bg-accent/15 border-accent text-accent font-semibold"
                      : "bg-surface-2 border-border text-text-secondary hover:text-text",
                  )}
                >
                  {cat}
                </button>
              ))}
            </div>

            {/* Legend Markers */}
            <div className="flex items-center gap-3 text-text-secondary">
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-sky-400" /> Edit
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-amber-400" /> Run (Fail)
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-emerald-400" /> Run (Pass)
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-purple-400" /> Hint
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-emerald-500" /> Submit
              </span>
            </div>
          </div>
        </div>

        {/* ── Active Event Snapshot Box ──────────────────────────────────── */}
        {activeEvent && (
          <motion.div
            key={activeEvent.raw.id}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.15 }}
            className="rounded-lg border border-accent/40 bg-accent-soft/10 p-3.5 space-y-2"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className={cn("px-2 py-0.5 rounded text-[11px] font-mono font-semibold border", activeEvent.badgeClass)}>
                  {activeEvent.title}
                </span>
                <span className="text-sm font-semibold text-text font-mono">
                  {activeEvent.summary}
                </span>
              </div>
              <span className="text-xs text-text-secondary font-mono">
                {activeEvent.relativeTime} ({activeEvent.timestamp})
              </span>
            </div>

            {/* Check breakdown if run or submit */}
            {activeEvent.checks && activeEvent.checks.length > 0 && (
              <div className="pt-2 border-t border-border/40 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                {activeEvent.checks.map((chk, i) => (
                  <div
                    key={chk.id || i}
                    className={cn(
                      "flex items-center justify-between px-2.5 py-1.5 rounded border text-xs font-mono",
                      chk.passed
                        ? "bg-pass-soft/30 border-pass/30 text-pass"
                        : "bg-fail-soft/30 border-fail/30 text-fail",
                    )}
                  >
                    <span>Check {chk.id}</span>
                    <span>{chk.passed ? "✓ PASS" : "✗ FAIL"}</span>
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </div>

      {/* ── Vertical Event List ─────────────────────────────────────────── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-text-secondary font-mono">
            Session Timeline Events ({filteredEvents.length})
          </h3>
          <span className="text-xs text-text-secondary font-mono">
            Click any row to jump scrubber
          </span>
        </div>

        <div
          ref={listContainerRef}
          className="max-h-[460px] overflow-y-auto space-y-2 pr-1 rounded-xl border border-border/60 bg-surface/50 p-2"
        >
          {filteredEvents.map((evt) => {
            const isSelected = evt.index === clampedIndex;

            return (
              <div
                key={evt.raw.id}
                ref={(el) => {
                  itemRefs.current[evt.index] = el;
                }}
                onClick={() => {
                  setIsPlaying(false);
                  setSelectedIndex(evt.index);
                }}
                className={cn(
                  "flex items-center justify-between px-4 py-3 rounded-lg border text-sm cursor-pointer transition-all",
                  isSelected
                    ? "border-accent bg-accent/15 ring-2 ring-accent/30 shadow-md font-medium"
                    : "border-border bg-surface hover:bg-surface-2",
                )}
                data-testid={`event-row-${evt.index}`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-xs font-mono text-text-secondary w-6 shrink-0">
                    #{evt.index + 1}
                  </span>

                  <span
                    className={cn(
                      "px-2 py-0.5 rounded text-[10px] font-mono font-semibold uppercase shrink-0 border",
                      evt.badgeClass,
                    )}
                  >
                    {evt.title}
                  </span>

                  <span className="text-sm text-text font-mono truncate">
                    {evt.summary}
                  </span>
                </div>

                <div className="flex items-center gap-3 shrink-0 ml-2">
                  <span className="text-xs font-mono text-accent font-semibold">
                    {evt.relativeTime}
                  </span>
                  <span className="text-xs font-mono text-text-secondary hidden sm:inline">
                    {evt.timestamp}
                  </span>
                  {isSelected && (
                    <span className="inline-block h-2 w-2 rounded-full bg-accent animate-pulse" />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
