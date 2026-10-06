"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState, useMemo } from "react";
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
    <div className="animate-pulse space-y-3" aria-label="Loading problems">
      {[1, 2, 3].map((i) => (
        <div key={i} className="h-16 rounded-lg bg-surface-2 border border-border" />
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

function StatusChip() {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-text-secondary font-mono">
      <span className="h-1.5 w-1.5 rounded-full bg-text-secondary/50" />
      Not started
    </span>
  );
}

// ── Problem row ────────────────────────────────────────────────────────────
function ProblemRow({ problem, index }: { problem: Problem; index: number }) {
  const reduce = useReducedMotion();

  return (
    <motion.div
      layout
      initial={reduce ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{
        duration: 0.2,
        delay: Math.min(index * 0.04, 0.2), // cap delay so long lists don't take forever
        layout: { duration: 0.2 },
      }}
    >
      <Link
        href={`/problems/${problem.slug}`}
        className={cn(
          "group flex items-center gap-4 px-4 py-3.5",
          "rounded-lg border border-border bg-surface",
          "hover:border-accent/40 hover:bg-accent-soft/30 transition-colors duration-150",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        )}
      >
        {/* Title + track */}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-text group-hover:text-accent transition-colors">
            {problem.title}
          </p>
          <div className="mt-1 flex items-center gap-2">
            <TrackBadge track={problem.track} />
            <span className="text-xs text-text-secondary font-mono">{problem.stack}</span>
          </div>
        </div>

        {/* Skills */}
        <div className="hidden sm:flex flex-wrap gap-1 max-w-[220px]">
          {problem.skills.map((skill) => (
            <SkillBadge key={skill} skill={skill} />
          ))}
        </div>

        {/* Difficulty */}
        <div className="w-20 text-right">
          <DifficultyBadge difficulty={problem.difficulty} />
        </div>

        {/* Est. time */}
        <div className="w-20 text-right text-xs text-text-secondary font-mono tabular-nums hidden md:block">
          {problem.estMinutes} min
        </div>

        {/* Status */}
        <div className="w-24 text-right">
          <StatusChip />
        </div>
      </Link>
    </motion.div>
  );
}

// ── Filter bar ─────────────────────────────────────────────────────────────
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
  const tracks = useMemo(
    () => ["all", ...Array.from(new Set(problems.map((p) => p.track))).sort()],
    [problems],
  );
  const skills = useMemo(
    () => ["all", ...Array.from(new Set(problems.flatMap((p) => p.skills))).sort()],
    [problems],
  );

  const selectClass =
    "h-8 rounded-md border border-border bg-surface px-2.5 text-xs text-text-secondary font-mono " +
    "focus:outline-none focus:ring-1 focus:ring-accent focus:border-accent transition-colors";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-text-secondary font-medium mr-1">Filter:</span>

      <select
        value={track}
        onChange={(e) => setTrack(e.target.value)}
        aria-label="Filter by track"
        className={selectClass}
      >
        {tracks.map((t) => (
          <option key={t} value={t}>
            {t === "all" ? "All tracks" : t}
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
        <option value="easy">Easy</option>
        <option value="medium">Medium</option>
        <option value="hard">Hard</option>
      </select>

      <select
        value={skill}
        onChange={(e) => setSkill(e.target.value)}
        aria-label="Filter by skill"
        className={selectClass}
      >
        {skills.map((s) => (
          <option key={s} value={s}>
            {s === "all" ? "All skills" : s}
          </option>
        ))}
      </select>

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
  const { data: problems = [], isLoading, isError, error } = useQuery({
    queryKey: ["problems"],
    queryFn: fetchProblems,
  });

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
        <p className="mt-2 text-sm text-text-secondary">
          Pick a ticket, fix the bug. Every problem is sourced from a real Postgres instance.
        </p>
      </motion.div>

      {/* ── Filters ── */}
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
                <ProblemRow key={problem.id} problem={problem} index={index} />
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
