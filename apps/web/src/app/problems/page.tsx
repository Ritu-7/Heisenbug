"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState, useMemo, useRef, useEffect } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { fetchProblems, type Problem } from "@/lib/api";
import { DifficultyBadge } from "@/components/badge";
import { cn } from "@/lib/utils";

// ── Filter state types ─────────────────────────────────────────────────────

type DifficultyFilter = "all" | "easy" | "medium" | "hard";

// ── Loading skeleton (compact rows) ───────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div className="animate-pulse" aria-label="Loading problems">
      {/* Table header skeleton */}
      <div className="mb-1 flex items-center gap-3 px-4 py-1.5">
        <div className="h-3 w-4 rounded bg-surface-2" />
        <div className="h-3 flex-1 rounded bg-surface-2" />
        <div className="h-3 w-32 rounded bg-surface-2" />
        <div className="h-3 w-16 rounded bg-surface-2" />
        <div className="h-3 w-14 rounded bg-surface-2" />
        <div className="h-3 w-10 rounded bg-surface-2" />
      </div>
      {[1, 2, 3, 4].map((i) => (
        <div
          key={i}
          className="h-10 rounded border border-border bg-surface-2 mb-px"
        />
      ))}
    </div>
  );
}

// ── Error banner ───────────────────────────────────────────────────────────

function ErrorBanner({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="rounded-lg border border-fail/40 bg-fail-soft px-4 py-3 text-sm text-fail font-mono"
    >
      <span className="font-semibold">Could not load problems:</span> {message}
      <p className="mt-1 text-xs text-fail/80 font-sans">
        Make sure the API server is running on{" "}
        <code className="font-mono">{process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"}</code>
        .
      </p>
    </div>
  );
}

// ── Empty state ────────────────────────────────────────────────────────────

function EmptyState({ filtered }: { filtered: boolean }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.2 }}
      className="py-12 text-center text-text-secondary"
    >
      {filtered ? (
        <>
          <p className="text-sm font-medium text-text">No problems match these filters.</p>
          <p className="mt-1 text-xs text-text-secondary">Try clearing a filter above.</p>
        </>
      ) : (
        <p className="text-sm font-medium text-text">No problems in the database yet.</p>
      )}
    </motion.div>
  );
}

// ── Solve status indicator ─────────────────────────────────────────────────
/**
 * Left-most column icon.
 * - solved === null  → guest: render nothing (dash) — no checkmark implied
 * - solved === false → authenticated, not solved: empty circle outline
 * - solved === true  → authenticated, passing submission exists: filled green check
 */
function SolveIndicator({ solved }: { solved: boolean | null }) {
  if (solved === null) {
    // Guest — show neutral dash, never imply a status
    return (
      <span className="flex h-5 w-5 items-center justify-center text-text-secondary/40" aria-label="Sign in to track progress">
        <svg width="12" height="2" viewBox="0 0 12 2" fill="none" aria-hidden="true">
          <rect width="12" height="2" rx="1" fill="currentColor" />
        </svg>
      </span>
    );
  }
  if (solved) {
    return (
      <span
        className="flex h-5 w-5 items-center justify-center rounded-full bg-pass text-white"
        aria-label="Solved"
        title="You have a passing submission for this problem"
      >
        <svg width="11" height="8" viewBox="0 0 11 8" fill="none" aria-hidden="true">
          <path d="M1 4L4 7L10 1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    );
  }
  return (
    <span
      className="flex h-5 w-5 items-center justify-center rounded-full border-2 border-text-secondary/30"
      aria-label="Not solved"
      title="Not yet solved"
    />
  );
}

// ── Skills overflow cell ───────────────────────────────────────────────────
/**
 * Shows up to `max` skill pills on one line; appends "+N" overflow badge
 * for any beyond that. No wrapping.
 */
function SkillsCell({
  skills,
  max = 2,
  activeSkill,
  onClickSkill,
}: {
  skills: string[];
  max?: number;
  activeSkill: string;
  onClickSkill: (s: string) => void;
}) {
  const visible = skills.slice(0, max);
  const overflow = skills.length - max;

  return (
    <div className="flex items-center gap-1 min-w-0 flex-nowrap overflow-hidden">
      {visible.map((skill) => (
        <button
          key={skill}
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onClickSkill(activeSkill === skill ? "all" : skill);
          }}
          className={cn(
            "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-medium whitespace-nowrap flex-none",
            "transition-colors",
            activeSkill === skill
              ? "bg-accent text-white border border-accent"
              : "bg-accent-soft text-accent border border-accent/20 hover:border-accent/50",
          )}
        >
          {skill}
        </button>
      ))}
      {overflow > 0 && (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono text-text-secondary/60 bg-surface-2 border border-border flex-none">
          +{overflow}
        </span>
      )}
    </div>
  );
}

// ── Solve rate cell ────────────────────────────────────────────────────────

function SolveRateCell({ rate }: { rate: number | null }) {
  if (rate === null) {
    return (
      <span className="text-xs font-mono text-text-secondary/40 tabular-nums" title="Not enough data yet">
        —
      </span>
    );
  }
  // Color it: green ≥ 60, yellow 30–59, red < 30
  const color =
    rate >= 60 ? "text-pass" : rate >= 30 ? "text-warning" : "text-fail";
  return (
    <span className={cn("text-xs font-mono tabular-nums", color)} title={`${rate}% solve rate (passing / total submissions)`}>
      {rate}%
    </span>
  );
}

// ── Table header row ───────────────────────────────────────────────────────

function TableHeader({ showSolveRate }: { showSolveRate: boolean }) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 px-4 py-1.5 text-[11px] font-medium text-text-secondary/60 uppercase tracking-wide",
        "border-b border-border",
      )}
      aria-hidden="true"
    >
      {/* Solved indicator column */}
      <span className="w-5 flex-none" />
      {/* Title */}
      <span className="flex-1 min-w-0">Problem</span>
      {/* Skills */}
      <span className="hidden sm:block w-44 flex-none">Skills</span>
      {/* Difficulty */}
      <span className="w-16 flex-none text-right">Difficulty</span>
      {/* Est time */}
      <span className="hidden md:block w-16 flex-none text-right">Est.</span>
      {/* Solve rate — only when any problem has real data */}
      {showSolveRate && (
        <span className="hidden lg:block w-16 flex-none text-right">Solve %</span>
      )}
      {/* Status */}
      <span className="w-20 flex-none text-right">Status</span>
    </div>
  );
}

// ── Problem row ─────────────────────────────────────────────────────────────

interface ProblemRowProps {
  problem: Problem;
  index: number;
  initialLoad: boolean;
  showSolveRate: boolean;
  activeSkill: string;
  onClickSkill: (s: string) => void;
}

function ProblemRow({
  problem,
  index,
  initialLoad,
  showSolveRate,
  activeSkill,
  onClickSkill,
}: ProblemRowProps) {
  const reduce = useReducedMotion();

  const rowInitial = reduce || !initialLoad ? false : { opacity: 0, x: -8 };
  const delayMs = initialLoad ? Math.min(index * 40, 250) : 0;

  // Status label: if authenticated and solved show "Solved", else "Not started"
  const statusLabel =
    problem.solved === true
      ? "Solved"
      : problem.solved === false
        ? "Not started"
        : "Not started"; // guest sees same as not-started, solve indicator column says sign-in

  const statusDotClass =
    problem.solved === true
      ? "bg-pass"
      : "bg-text-secondary/40";

  return (
    <motion.div
      layout
      initial={rowInitial}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0 }}
      transition={{
        duration: 0.18,
        delay: delayMs / 1000,
        layout: { duration: 0.15 },
      }}
      className="group/row"
    >
      <Link
        href={`/problems/${problem.slug}`}
        className={cn(
          "flex items-center gap-3 px-4 py-2.5",
          "border-b border-border",
          "hover:bg-accent-soft/20 transition-colors duration-100",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent",
          problem.solved === true && "bg-pass-soft/10",
        )}
      >
        {/* Solved status indicator */}
        <div className="w-5 flex-none flex items-center justify-center">
          <SolveIndicator solved={problem.solved} />
        </div>

        {/* Title */}
        <div className="flex-1 min-w-0">
          <span
            className={cn(
              "text-sm font-medium truncate block",
              problem.solved === true
                ? "text-text group-hover/row:text-pass transition-colors"
                : "text-text group-hover/row:text-accent transition-colors",
            )}
          >
            {problem.title}
          </span>
          {/* Track + stack visible below title on mobile where columns are hidden */}
          <span className="sm:hidden text-[10px] text-text-secondary font-mono">
            {problem.track} · {problem.stack}
          </span>
        </div>

        {/* Skills */}
        <div className="hidden sm:flex w-44 flex-none items-center">
          <SkillsCell
            skills={problem.skills}
            max={2}
            activeSkill={activeSkill}
            onClickSkill={onClickSkill}
          />
        </div>

        {/* Difficulty */}
        <div className="w-16 flex-none flex justify-end">
          <DifficultyBadge difficulty={problem.difficulty} />
        </div>

        {/* Est. time */}
        <div className="hidden md:block w-16 flex-none text-right text-xs text-text-secondary font-mono tabular-nums">
          {problem.estMinutes}m
        </div>

        {/* Solve rate */}
        {showSolveRate && (
          <div className="hidden lg:flex w-16 flex-none justify-end">
            <SolveRateCell rate={problem.solveRate} />
          </div>
        )}

        {/* Status */}
        <div className="w-20 flex-none flex justify-end">
          <span className="inline-flex items-center gap-1 text-xs font-mono text-text-secondary">
            <span className={cn("h-1.5 w-1.5 rounded-full flex-none", statusDotClass)} />
            {statusLabel}
          </span>
        </div>
      </Link>
    </motion.div>
  );
}

// ── Skill pill filter bar ─────────────────────────────────────────────────
/**
 * Horizontal scrollable row of one pill per skill that actually exists in
 * the current problem set. Clicking a pill toggles that skill filter.
 * "All" pill resets to no skill filter.
 */
function SkillPillBar({
  skills,
  activeSkill,
  setSkill,
  skillCounts,
}: {
  skills: string[];
  activeSkill: string;
  setSkill: (v: string) => void;
  skillCounts: Record<string, number>;
}) {
  if (skills.length === 0) return null;

  const pillBase =
    "inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-mono font-medium whitespace-nowrap transition-colors flex-none";

  return (
    <div className="flex items-center gap-2 overflow-x-auto pb-0.5 scroll-smooth scrollbar-none" style={{ scrollbarWidth: "none" }}>
      <button
        type="button"
        onClick={() => setSkill("all")}
        className={cn(
          pillBase,
          activeSkill === "all"
            ? "bg-accent text-white"
            : "bg-surface-2 text-text-secondary border border-border hover:border-accent/40 hover:text-accent",
        )}
      >
        All
      </button>
      {skills.map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => setSkill(activeSkill === s ? "all" : s)}
          className={cn(
            pillBase,
            activeSkill === s
              ? "bg-accent text-white"
              : "bg-accent-soft text-accent border border-accent/20 hover:border-accent/50",
          )}
        >
          {s}
          <span
            className={cn(
              "text-[10px]",
              activeSkill === s ? "text-white/70" : "text-accent/60",
            )}
          >
            {skillCounts[s] ?? 0}
          </span>
        </button>
      ))}
    </div>
  );
}

// ── Track / Difficulty dropdowns ──────────────────────────────────────────

interface DropdownFiltersProps {
  problems: Problem[];
  difficulty: DifficultyFilter;
  setDifficulty: (v: DifficultyFilter) => void;
  track: string;
  setTrack: (v: string) => void;
}

function DropdownFilters({
  problems,
  difficulty,
  setDifficulty,
  track,
  setTrack,
}: DropdownFiltersProps) {
  const trackCounts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const p of problems) map[p.track] = (map[p.track] ?? 0) + 1;
    return map;
  }, [problems]);

  const diffCounts = useMemo(() => {
    const map: Record<string, number> = { easy: 0, medium: 0, hard: 0 };
    for (const p of problems) {
      if (p.difficulty in map) map[p.difficulty]++;
    }
    return map;
  }, [problems]);

  const tracks = useMemo(
    () => Array.from(new Set(problems.map((p) => p.track))).sort(),
    [problems],
  );

  const selectClass =
    "h-7 rounded border border-border bg-surface px-2 text-xs text-text-secondary font-mono " +
    "focus:outline-none focus:ring-1 focus:ring-accent focus:border-accent transition-colors";

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <select
        value={track}
        onChange={(e) => setTrack(e.target.value)}
        aria-label="Filter by track"
        className={selectClass}
      >
        <option value="all">All tracks ({problems.length})</option>
        {tracks.map((t) => (
          <option key={t} value={t}>
            {t} ({trackCounts[t] ?? 0})
          </option>
        ))}
      </select>

      <select
        value={difficulty}
        onChange={(e) => setDifficulty(e.target.value as DifficultyFilter)}
        aria-label="Filter by difficulty"
        className={selectClass}
      >
        <option value="all">All difficulties</option>
        <option value="easy">Easy ({diffCounts.easy})</option>
        <option value="medium">Medium ({diffCounts.medium})</option>
        <option value="hard">Hard ({diffCounts.hard})</option>
      </select>
    </div>
  );
}

// ── Hero stat line ─────────────────────────────────────────────────────────

function HeroStatLine({ problems }: { problems: Problem[] }) {
  const tracks = useMemo(
    () => Array.from(new Set(problems.map((p) => p.track))).sort(),
    [problems],
  );
  if (problems.length === 0) return null;

  const solvedCount = problems.filter((p) => p.solved === true).length;
  const showSolvedCount = problems.some((p) => p.solved !== null);

  return (
    <p className="mt-1.5 text-xs text-text-secondary font-mono leading-relaxed">
      <span className="text-text font-medium">{problems.length}</span>{" "}
      problem{problems.length !== 1 ? "s" : ""}{" · "}
      <span className="text-text font-medium">{tracks.length}</span>{" "}
      track{tracks.length !== 1 ? "s" : ""}{" — "}
      {tracks.join(", ")}
      {showSolvedCount && (
        <>
          {" · "}
          <span className="text-pass font-medium">{solvedCount}</span> solved
        </>
      )}
    </p>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function ProblemsPage() {
  const reduce = useReducedMotion();
  const { data: problems = [], isLoading, isError, error, isSuccess } = useQuery({
    queryKey: ["problems"],
    queryFn: fetchProblems,
  });

  // Only the first real load gets staggered entrance; filter changes don't.
  const didInitialLoad = useRef(false);
  const [initialLoad, setInitialLoad] = useState(false);
  useEffect(() => {
    if (isSuccess && !didInitialLoad.current) {
      didInitialLoad.current = true;
      setInitialLoad(true);
    }
  }, [isSuccess]);

  const [difficulty, setDifficulty] = useState<DifficultyFilter>("all");
  const [track, setTrack] = useState<string>("all");
  const [skill, setSkill] = useState<string>("all");

  // Derived: all unique skills across all real problems
  const allSkills = useMemo(
    () => Array.from(new Set(problems.flatMap((p) => p.skills))).sort(),
    [problems],
  );

  const skillCounts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const p of problems) {
      for (const s of p.skills) map[s] = (map[s] ?? 0) + 1;
    }
    return map;
  }, [problems]);

  const filtered = useMemo(() => {
    return problems.filter((p) => {
      if (difficulty !== "all" && p.difficulty !== difficulty) return false;
      if (track !== "all" && p.track !== track) return false;
      if (skill !== "all" && !p.skills.includes(skill)) return false;
      return true;
    });
  }, [problems, difficulty, track, skill]);

  const hasActiveFilter = difficulty !== "all" || track !== "all" || skill !== "all";

  // Show solve-rate column only if ANY problem in the full set has real data
  const showSolveRate = problems.some((p) => p.solveRate !== null);

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      {/* ── Header ── */}
      <motion.div
        initial={reduce ? false : { opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="mb-6"
      >
        <h1 className="font-serif text-3xl font-semibold text-text tracking-tight">
          Problem Catalogue
        </h1>
        {isSuccess && <HeroStatLine problems={problems} />}
        {!isSuccess && !isError && (
          <p className="mt-1.5 text-sm text-text-secondary">
            Pick a ticket, fix the bug. Every problem is sourced from a real Postgres instance.
          </p>
        )}
      </motion.div>

      {/* ── Filters ── */}
      {!isLoading && !isError && (
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18 }}
          className="mb-4 space-y-2"
        >
          {/* Skill pills — one per real tag in the dataset */}
          <SkillPillBar
            skills={allSkills}
            activeSkill={skill}
            setSkill={setSkill}
            skillCounts={skillCounts}
          />

          {/* Track + Difficulty dropdowns (orthogonal axes, still useful) */}
          <DropdownFilters
            problems={problems}
            difficulty={difficulty}
            setDifficulty={setDifficulty}
            track={track}
            setTrack={setTrack}
          />
        </motion.div>
      )}

      {/* ── Results count ── */}
      {!isLoading && !isError && (
        <p className="mb-1 text-xs text-text-secondary font-mono">
          {filtered.length} problem{filtered.length !== 1 ? "s" : ""}
          {hasActiveFilter ? " (filtered)" : ""}
        </p>
      )}

      {/* ── Table ── */}
      {isLoading && <LoadingSkeleton />}
      {isError && <ErrorBanner message={(error as Error).message} />}

      {!isLoading && !isError && (
        <div className="rounded-lg border border-border overflow-hidden">
          {filtered.length > 0 && (
            <TableHeader showSolveRate={showSolveRate} />
          )}
          <motion.div layout>
            <AnimatePresence mode="popLayout" initial={false}>
              {filtered.length === 0 ? (
                <EmptyState key="empty" filtered={hasActiveFilter} />
              ) : (
                filtered.map((problem, index) => (
                  <ProblemRow
                    key={problem.id}
                    problem={problem}
                    index={index}
                    initialLoad={initialLoad}
                    showSolveRate={showSolveRate}
                    activeSkill={skill}
                    onClickSkill={setSkill}
                  />
                ))
              )}
            </AnimatePresence>
          </motion.div>
        </div>
      )}

      {/* ── Footer note ── */}
      {!isLoading && !isError && (
        <p className="mt-6 text-center text-xs text-text-secondary/50 font-mono">
          Showing all {problems.length} problem{problems.length !== 1 ? "s" : ""} in the database.
        </p>
      )}
    </div>
  );
}
