"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState, useMemo, useRef, useEffect } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { fetchProblems, type Problem } from "@/lib/api";
import { DifficultyBadge, SkillBadge, TrackBadge } from "@/components/badge";
import { cn } from "@/lib/utils";

// ── Filter state types ─────────────────────────────────────────────────────

type DifficultyFilter = "all" | "easy" | "medium" | "hard";
type StatusFilter = "all" | "not_started";

// ── Sub-components ─────────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div className="animate-pulse space-y-2.5" aria-label="Loading problems">
      {[1, 2, 3].map((i) => (
        <div key={i} className="h-[72px] rounded-lg bg-surface-2 border border-border" />
      ))}
    </div>
  );
}

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

function EmptyState({ filtered }: { filtered: boolean }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.2 }}
      className="py-16 text-center text-text-secondary"
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

// ── Check dots ─────────────────────────────────────────────────────────────
/**
 * Small rounded-square dots representing total check count (visible + hidden).
 * Filled = checks exist. Not a pass/fail indicator — honest to guests.
 */
function CheckDots({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <div
      className="flex items-center gap-[3px]"
      title={`${count} checks (visible + hidden)`}
      aria-label={`${count} checks`}
    >
      {Array.from({ length: count }).map((_, i) => (
        <span
          key={i}
          className="h-[5px] w-[5px] rounded-[1px] bg-text-secondary/35 flex-none"
        />
      ))}
    </div>
  );
}

// ── Problem row ─────────────────────────────────────────────────────────────
interface ProblemRowProps {
  problem: Problem;
  index: number;
  initialLoad: boolean;
}

function ProblemRow({ problem, index, initialLoad }: ProblemRowProps) {
  const reduce = useReducedMotion();

  const rowInitial = reduce || !initialLoad
    ? false
    : { opacity: 0, x: -10 };

  const delayMs = initialLoad ? Math.min(index * 55, 330) : 0;

  return (
    <motion.div
      layout
      initial={rowInitial}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{
        duration: 0.22,
        delay: delayMs / 1000,
        layout: { duration: 0.18 },
      }}
      className="relative group/row"
    >
      {/* Diff-gutter accent bar */}
      <span
        className={cn(
          "absolute left-0 top-[6px] bottom-[6px] rounded-full transition-[width] duration-150",
          "w-[3px] group-hover/row:w-[5px]",
          "bg-accent", // not-started color — all problems in catalogue are not-started for a guest
        )}
        aria-hidden="true"
      />

      <Link
        href={`/problems/${problem.slug}`}
        className={cn(
          "flex items-center gap-4 pl-5 pr-4 py-3.5",
          "rounded-lg border border-border bg-surface",
          "hover:border-accent/40 hover:bg-accent-soft/30 transition-colors duration-150",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        )}
      >
        {/* Title + track */}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-text group-hover/row:text-accent transition-colors">
            {problem.title}
          </p>
          <div className="mt-1.5 flex items-center gap-2">
            <TrackBadge track={problem.track} />
            <span className="text-xs text-text-secondary font-mono">{problem.stack}</span>
          </div>
        </div>

        {/* Skills */}
        <div className="hidden sm:flex flex-wrap gap-1 max-w-[200px]">
          {problem.skills.map((skill) => (
            <SkillBadge key={skill} skill={skill} />
          ))}
        </div>

        {/* Difficulty + check dots */}
        <div className="flex flex-col items-end gap-1.5 w-20">
          <DifficultyBadge difficulty={problem.difficulty} />
          <CheckDots count={problem.checkCount} />
        </div>

        {/* Est. time */}
        <div className="w-20 text-right text-xs text-text-secondary font-mono tabular-nums hidden md:block">
          {problem.estMinutes} min
        </div>

        {/* Status */}
        <div className="w-24 text-right">
          <span className="inline-flex items-center gap-1.5 text-xs text-text-secondary font-mono">
            <span className="h-1.5 w-1.5 rounded-full bg-text-secondary/50" />
            Not started
          </span>
        </div>
      </Link>
    </motion.div>
  );
}

// ── Hero stat line ─────────────────────────────────────────────────────────
function HeroStatLine({ problems }: { problems: Problem[] }) {
  const tracks = useMemo(
    () => Array.from(new Set(problems.map((p) => p.track))).sort(),
    [problems],
  );

  if (problems.length === 0) return null;

  return (
    <p className="mt-2 text-xs text-text-secondary font-mono leading-relaxed">
      <span className="text-text font-medium">{problems.length}</span>{" "}
      real problem{problems.length !== 1 ? "s" : ""}{" · "}
      <span className="text-text font-medium">{tracks.length}</span>{" "}
      track{tracks.length !== 1 ? "s" : ""}{" — "}
      {tracks.join(", ")}{" · "}
      hidden tvalues never reach the candidate container
    </p>
  );
}

// ── Filter rail ────────────────────────────────────────────────────────────
interface FilterBarProps {
  problems: Problem[];
  difficulty: DifficultyFilter;
  setDifficulty: (v: DifficultyFilter) => void;
  track: string;
  setTrack: (v: string) => void;
  skill: string;
  setSkill: (v: string) => void;
  status: StatusFilter;
  setStatus: (v: StatusFilter) => void;
}

function FilterBar({
  problems,
  difficulty, setDifficulty,
  track, setTrack,
  skill, setSkill,
  status, setStatus,
}: FilterBarProps) {
  // Derive real counts per option from the full fetched dataset
  const trackCounts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const p of problems) {
      map[p.track] = (map[p.track] ?? 0) + 1;
    }
    return map;
  }, [problems]);

  const diffCounts = useMemo(() => {
    const map: Record<string, number> = { easy: 0, medium: 0, hard: 0 };
    for (const p of problems) {
      if (p.difficulty in map) map[p.difficulty]++;
    }
    return map;
  }, [problems]);

  const skillCounts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const p of problems) {
      for (const s of p.skills) {
        map[s] = (map[s] ?? 0) + 1;
      }
    }
    return map;
  }, [problems]);

  const tracks = useMemo(
    () => Array.from(new Set(problems.map((p) => p.track))).sort(),
    [problems],
  );

  const skills = useMemo(
    () => Array.from(new Set(problems.flatMap((p) => p.skills))).sort(),
    [problems],
  );

  const selectClass =
    "h-8 rounded-md border border-border bg-surface px-2.5 text-xs text-text-secondary font-mono " +
    "focus:outline-none focus:ring-1 focus:ring-accent focus:border-accent transition-colors";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-text-secondary font-medium mr-1">Filter:</span>

      {/* Track filter with real counts */}
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

      {/* Difficulty filter with real counts */}
      <select
        value={difficulty}
        onChange={(e) => setDifficulty(e.target.value as DifficultyFilter)}
        aria-label="Filter by difficulty"
        className={selectClass}
      >
        <option value="all">All difficulties ({problems.length})</option>
        <option value="easy">Easy ({diffCounts.easy})</option>
        <option value="medium">Medium ({diffCounts.medium})</option>
        <option value="hard">Hard ({diffCounts.hard})</option>
      </select>

      {/* Skill filter with real counts */}
      <select
        value={skill}
        onChange={(e) => setSkill(e.target.value)}
        aria-label="Filter by skill"
        className={selectClass}
      >
        <option value="all">All skills</option>
        {skills.map((s) => (
          <option key={s} value={s}>
            {s} ({skillCounts[s] ?? 0})
          </option>
        ))}
      </select>

      {/* Status filter */}
      <select
        value={status}
        onChange={(e) => setStatus(e.target.value as StatusFilter)}
        aria-label="Filter by status"
        className={selectClass}
      >
        <option value="all">All statuses</option>
        <option value="not_started">Not started</option>
      </select>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function ProblemsPage() {
  const reduce = useReducedMotion();
  const { data: problems = [], isLoading, isError, error, isSuccess } = useQuery({
    queryKey: ["problems"],
    queryFn: fetchProblems,
  });

  // Track whether we've completed the first real load.
  // Only the initial data load gets the staggered entrance — filter changes don't re-trigger it.
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
  const [status, setStatus] = useState<StatusFilter>("all");

  const filtered = useMemo(() => {
    return problems.filter((p) => {
      if (difficulty !== "all" && p.difficulty !== difficulty) return false;
      if (track !== "all" && p.track !== track) return false;
      if (skill !== "all" && !p.skills.includes(skill)) return false;
      if (status === "not_started") return true;
      return true;
    });
  }, [problems, difficulty, track, skill, status]);

  const hasActiveFilter =
    difficulty !== "all" || track !== "all" || skill !== "all" || status !== "all";

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      {/* ── Header ── */}
      <motion.div
        initial={reduce ? false : { opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22 }}
        className="mb-8"
      >
        <h1 className="font-serif text-3xl font-semibold text-text tracking-tight">
          Problem Catalogue
        </h1>
        {/* Honest hero stat line — derived from real fetched data, no hardcoded numbers */}
        {isSuccess && <HeroStatLine problems={problems} />}
        {!isSuccess && !isError && (
          <p className="mt-2 text-sm text-text-secondary">
            Pick a ticket, fix the bug. Every problem is sourced from a real Postgres instance.
          </p>
        )}
      </motion.div>

      {/* ── Filters with live counts ── */}
      {!isLoading && !isError && (
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="mb-5"
        >
          <FilterBar
            problems={problems}
            difficulty={difficulty} setDifficulty={setDifficulty}
            track={track} setTrack={setTrack}
            skill={skill} setSkill={setSkill}
            status={status} setStatus={setStatus}
          />
        </motion.div>
      )}

      {/* ── Results header ── */}
      {!isLoading && !isError && (
        <div className="mb-3 flex items-center justify-between">
          <p className="text-xs text-text-secondary font-mono">
            {filtered.length} problem{filtered.length !== 1 ? "s" : ""}
            {hasActiveFilter ? " (filtered)" : ""}
          </p>
          <div className="hidden md:flex items-center gap-4 text-xs text-text-secondary font-medium pr-1">
            <span className="w-20 text-right">Difficulty</span>
            <span className="w-20 text-right">Est. time</span>
            <span className="w-24 text-right">Status</span>
          </div>
        </div>
      )}

      {/* ── Content ── */}
      {isLoading && <LoadingSkeleton />}
      {isError && <ErrorBanner message={(error as Error).message} />}
      {!isLoading && !isError && (
        <motion.div layout className="space-y-2">
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
                />
              ))
            )}
          </AnimatePresence>
        </motion.div>
      )}

      {/* ── Footer note ── */}
      {!isLoading && !isError && (
        <p className="mt-8 text-center text-xs text-text-secondary/60 font-mono">
          Showing all {problems.length} problem{problems.length !== 1 ? "s" : ""} in the database.
        </p>
      )}
    </div>
  );
}
