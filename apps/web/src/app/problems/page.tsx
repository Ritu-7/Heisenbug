"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { fetchProblems, fetchUserSessions, type Problem, type Session } from "@/lib/api";
import { DifficultyBadge } from "@/components/badge";
import { cn } from "@/lib/utils";

// ── Types ──────────────────────────────────────────────────────────────────

type DifficultyFilter = "all" | "easy" | "medium" | "hard";
type StatusFilter = "all" | "Not started" | "In progress" | "Solved";
type SortOption = "default" | "time" | "title";

interface ViewOptions {
  dense: boolean;
  skills: boolean;
  track: boolean;
}

interface SubmissionRecord {
  id: string;
  problemId: string;
  problemTitle: string;
  problemSlug: string;
  at: string;
  result: "accepted" | "failed";
  score: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function formatMinutes(m: number): string {
  if (m >= 60) {
    const h = Math.floor(m / 60);
    const rem = m % 60;
    return rem > 0 ? `${h}h ${rem}m` : `${h}h`;
  }
  return `${m}m`;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ── Animated Number ────────────────────────────────────────────────────────

function AnimatedNumber({ value }: { value: number }) {
  const [displayValue, setDisplayValue] = useState(0);
  const reduce = useReducedMotion();

  useEffect(() => {
    if (reduce) {
      setDisplayValue(value);
      return;
    }
    let startTimestamp: number | null = null;
    const duration = 600;
    const startValue = 0;

    const step = (timestamp: number) => {
      if (!startTimestamp) startTimestamp = timestamp;
      const progress = Math.min((timestamp - startTimestamp) / duration, 1);
      // easeOutCubic
      const current = Math.round(startValue + (value - startValue) * (1 - Math.pow(1 - progress, 3)));
      setDisplayValue(current);
      if (progress < 1) {
        requestAnimationFrame(step);
      }
    };

    requestAnimationFrame(step);
  }, [value, reduce]);

  return <span>{displayValue}</span>;
}

// ── Solve Indicator ────────────────────────────────────────────────────────

function SolveIndicator({ solved, inProgress }: { solved: boolean | null; inProgress: boolean }) {
  if (solved === null) {
    return (
      <span className="flex h-5 w-5 items-center justify-center text-text-secondary/30" title="Sign in to track progress">
        <svg width="10" height="2" viewBox="0 0 10 2" fill="none" aria-hidden="true">
          <rect width="10" height="2" rx="1" fill="currentColor" />
        </svg>
      </span>
    );
  }
  if (solved) {
    return (
      <span
        className="flex h-5 w-5 items-center justify-center rounded-full bg-pass text-white shadow-sm ring-2 ring-pass/20"
        title="Solved (passing submission)"
      >
        <svg width="10" height="8" viewBox="0 0 11 8" fill="none" aria-hidden="true">
          <path d="M1 4L4 7L10 1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    );
  }
  if (inProgress) {
    return (
      <span
        className="flex h-5 w-5 items-center justify-center rounded-full border-2 border-warning text-warning bg-warning-soft/20"
        title="In progress (attempted)"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-warning" />
      </span>
    );
  }
  return (
    <span
      className="flex h-5 w-5 items-center justify-center rounded-full border-2 border-border/80 group-hover:border-accent/60 transition-colors"
      title="Not started"
    />
  );
}

// ── Circular Progress Ring ─────────────────────────────────────────────────

function ProgressRing({ percent }: { percent: number }) {
  return (
    <div
      className="relative w-16 h-16 rounded-full flex items-center justify-center flex-none transition-all duration-700"
      style={{
        background: `conic-gradient(var(--pass) ${percent * 3.6}deg, var(--surface-2) 0deg)`,
      }}
    >
      <div className="absolute inset-[6px] rounded-full bg-surface flex items-center justify-center shadow-inner">
        <span className="font-mono text-sm font-semibold text-text tabular-nums">{percent}%</span>
      </div>
    </div>
  );
}

// ── Mini Progress Bar ──────────────────────────────────────────────────────

function MeterBar({ label, current, total }: { label: string; current: number; total: number }) {
  const pct = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;
  return (
    <div className="grid grid-cols-[76px_1fr_40px] items-center gap-2.5 py-1 text-xs font-mono text-text-secondary">
      <span className="truncate capitalize">{label}</span>
      <div className="h-1.5 w-full rounded-full bg-surface-2 overflow-hidden">
        <div
          className="h-full rounded-full bg-accent transition-all duration-700 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-right text-[11px] tabular-nums text-text-secondary/80">
        {current}/{total}
      </span>
    </div>
  );
}

// ── Main Page Component ────────────────────────────────────────────────────

export default function ProblemsPage() {
  const router = useRouter();
  const reduce = useReducedMotion();

  // Queries
  const { data: problems = [], isLoading: isLoadingProblems, isError, error } = useQuery({
    queryKey: ["problems"],
    queryFn: fetchProblems,
  });

  const { data: userSessions = [] } = useQuery({
    queryKey: ["userSessions"],
    queryFn: fetchUserSessions,
    staleTime: 15 * 1000,
  });

  // Extract user submissions from sessions
  const userSubmissions = useMemo<SubmissionRecord[]>(() => {
    if (!userSessions || userSessions.length === 0) return [];
    const list: SubmissionRecord[] = [];
    for (const s of userSessions) {
      const prob = s.version?.problem;
      if (s.submissions && s.submissions.length > 0) {
        for (const sub of s.submissions) {
          list.push({
            id: sub.id,
            problemId: prob?.id ?? s.id,
            problemTitle: prob?.title ?? "Problem",
            problemSlug: prob?.slug ?? "",
            at: sub.createdAt,
            result: sub.score === 100 ? "accepted" : "failed",
            score: sub.score,
          });
        }
      }
    }
    return list.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  }, [userSessions]);

  // Set of problem IDs that the user has attempted (active sessions or submissions)
  const inProgressProblemIds = useMemo(() => {
    const set = new Set<string>();
    for (const s of userSessions) {
      const pId = s.version?.problem?.id;
      if (pId) set.add(pId);
    }
    return set;
  }, [userSessions]);

  // Filter & Search states
  const [track, setTrack] = useState<string>("all");
  const [difficulty, setDifficulty] = useState<DifficultyFilter>("all");
  const [skill, setSkill] = useState<string>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [sortOption, setSortOption] = useState<SortOption>("default");

  // View Options (persisted in localStorage)
  const [viewOptions, setViewOptions] = useState<ViewOptions>(() => {
    if (typeof window !== "undefined") {
      try {
        const stored = localStorage.getItem("hb-view");
        if (stored) return JSON.parse(stored);
      } catch {
        // fallback
      }
    }
    return { dense: false, skills: true, track: true };
  });

  const [viewDropdownOpen, setViewDropdownOpen] = useState(false);
  const viewDropdownRef = useRef<HTMLDivElement>(null);

  // Row "More" menu
  const [activeMenuProblem, setActiveMenuProblem] = useState<Problem | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);

  // Toast
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const toastTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const showToast = useCallback((msg: string) => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setToastMsg(msg);
    toastTimeoutRef.current = setTimeout(() => {
      setToastMsg(null);
    }, 2200);
  }, []);

  const updateViewOptions = (updates: Partial<ViewOptions>) => {
    setViewOptions((prev) => {
      const next = { ...prev, ...updates };
      try {
        localStorage.setItem("hb-view", JSON.stringify(next));
      } catch {}
      return next;
    });
  };

  // Close popovers on outside click
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (viewDropdownRef.current && !viewDropdownRef.current.contains(e.target as Node)) {
        setViewDropdownOpen(false);
      }
      if (!(e.target as HTMLElement).closest("[data-more-trigger]")) {
        setActiveMenuProblem(null);
      }
    };
    document.addEventListener("click", handleOutsideClick);
    return () => document.removeEventListener("click", handleOutsideClick);
  }, []);

  // Calendar state
  const [calMonth, setCalMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [selectedCalDay, setSelectedCalDay] = useState<string | null>(null);

  const subsByDay = useMemo(() => {
    const m = new Map<string, SubmissionRecord[]>();
    for (const sub of userSubmissions) {
      const k = new Date(sub.at).toDateString();
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(sub);
    }
    return m;
  }, [userSubmissions]);

  // Calculate problem status
  const getProblemStatus = useCallback(
    (p: Problem): "Solved" | "In progress" | "Not started" => {
      if (p.solved === true) return "Solved";
      if (inProgressProblemIds.has(p.id)) return "In progress";
      return "Not started";
    },
    [inProgressProblemIds]
  );

  // Tracks, skills, and summary counts
  const allTracks = useMemo(() => Array.from(new Set(problems.map((p) => p.track))).sort(), [problems]);
  const allSkills = useMemo(() => Array.from(new Set(problems.flatMap((p) => p.skills))).sort(), [problems]);

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

  const skillCounts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const p of problems) {
      for (const s of p.skills) map[s] = (map[s] ?? 0) + 1;
    }
    return map;
  }, [problems]);

  const statusCounts = useMemo(() => {
    let notStarted = 0;
    let inProgress = 0;
    let solved = 0;
    for (const p of problems) {
      const st = getProblemStatus(p);
      if (st === "Solved") solved++;
      else if (st === "In progress") inProgress++;
      else notStarted++;
    }
    return { "Not started": notStarted, "In progress": inProgress, Solved: solved };
  }, [problems, getProblemStatus]);

  // Filtered & Sorted problems
  const filteredProblems = useMemo(() => {
    let result = problems.filter((p) => {
      if (track !== "all" && p.track !== track) return false;
      if (difficulty !== "all" && p.difficulty !== difficulty) return false;
      if (skill !== "all" && !p.skills.includes(skill)) return false;
      if (status !== "all" && getProblemStatus(p) !== status) return false;
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim();
        const matchesTitle = p.title.toLowerCase().includes(query);
        const matchesSkills = p.skills.some((s) => s.toLowerCase().includes(query));
        const matchesTrack = p.track.toLowerCase().includes(query);
        if (!matchesTitle && !matchesSkills && !matchesTrack) return false;
      }
      return true;
    });

    if (sortOption === "time") {
      result = [...result].sort((a, b) => a.estMinutes - b.estMinutes);
    } else if (sortOption === "title") {
      result = [...result].sort((a, b) => a.title.localeCompare(b.title));
    }

    return result;
  }, [problems, track, difficulty, skill, status, searchQuery, sortOption, getProblemStatus]);

  // Overall metrics
  const totalMinutes = useMemo(() => problems.reduce((acc, p) => acc + p.estMinutes, 0), [problems]);
  const doneMinutes = useMemo(
    () => problems.filter((p) => p.solved === true).reduce((acc, p) => acc + p.estMinutes, 0),
    [problems]
  );
  const solvedCount = statusCounts.Solved;
  const totalCount = problems.length;
  const overallPercent = totalCount > 0 ? Math.round((solvedCount / totalCount) * 100) : 0;

  // Next unsolved problem for "Up Next" widget
  const nextUnsolvedProblem = useMemo(() => {
    return problems.find((p) => p.solved !== true);
  }, [problems]);

  // Streak calculations
  const streakStats = useMemo(() => {
    const DAY = 864e5;
    const key = (d: string | Date) => {
      const x = new Date(d);
      return new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    };
    const acceptedDays = Array.from(
      new Set(userSubmissions.filter((s) => s.result === "accepted").map((s) => key(s.at)))
    ).sort((a, b) => a - b);

    let best = 0;
    let run = 0;
    acceptedDays.forEach((d, i) => {
      run = i && Math.round((d - acceptedDays[i - 1]) / DAY) === 1 ? run + 1 : 1;
      best = Math.max(best, run);
    });

    let cur = 0;
    let c = key(new Date());
    if (!acceptedDays.includes(c)) c -= DAY;
    while (acceptedDays.includes(c)) {
      cur++;
      c -= DAY;
    }

    const solvedSkillsCount = new Set(
      problems.filter((p) => p.solved === true).flatMap((p) => p.skills)
    ).size;

    return { cur, best, solvedSkillsCount, allSkillsCount: allSkills.length };
  }, [userSubmissions, problems, allSkills]);

  return (
    <div className="w-full min-h-[calc(100vh-3.5rem)] flex flex-col justify-between">
      {/* ── Main Shell ── */}
      <div className="mx-auto max-w-[1440px] w-full px-4 sm:px-6 py-7 grid grid-cols-1 lg:grid-cols-[220px_minmax(0,1fr)] xl:grid-cols-[230px_minmax(0,1fr)_290px] gap-7 items-start">
        {/* ── Left Sidebar (Browse, Tracks, Difficulty, Status, Time Budget, Activity) ── */}
        <aside className="space-y-5 lg:sticky lg:top-20">
          {/* Browse */}
          <div className="space-y-1">
            <div className="px-2.5 text-[11px] font-mono font-medium uppercase tracking-wider text-text-secondary/70">
              Browse
            </div>
            <button
              type="button"
              onClick={() => {
                setTrack("all");
                setDifficulty("all");
                setSkill("all");
                setStatus("all");
              }}
              className={cn(
                "w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-colors text-left",
                track === "all" && difficulty === "all" && skill === "all" && status === "all"
                  ? "bg-accent-soft text-accent font-semibold"
                  : "text-text-secondary hover:text-text hover:bg-surface-2"
              )}
            >
              <span>All problems</span>
              <span className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-surface border border-border/60">
                {problems.length}
              </span>
            </button>
          </div>

          {/* Tracks */}
          <div className="space-y-1">
            <div className="px-2.5 text-[11px] font-mono font-medium uppercase tracking-wider text-text-secondary/70">
              Tracks
            </div>
            {allTracks.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTrack(track === t ? "all" : t)}
                className={cn(
                  "w-full flex items-center justify-between px-3 py-1.5 rounded-lg text-xs font-medium transition-colors capitalize text-left",
                  track === t
                    ? "bg-accent-soft text-accent font-semibold"
                    : "text-text-secondary hover:text-text hover:bg-surface-2"
                )}
              >
                <span>{t}</span>
                <span className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-surface border border-border/60">
                  {trackCounts[t] ?? 0}
                </span>
              </button>
            ))}
          </div>

          {/* Difficulty */}
          <div className="space-y-1">
            <div className="px-2.5 text-[11px] font-mono font-medium uppercase tracking-wider text-text-secondary/70">
              Difficulty
            </div>
            {(["easy", "medium", "hard"] as const).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDifficulty(difficulty === d ? "all" : d)}
                className={cn(
                  "w-full flex items-center justify-between px-3 py-1.5 rounded-lg text-xs font-medium transition-colors capitalize text-left",
                  difficulty === d
                    ? "bg-accent-soft text-accent font-semibold"
                    : "text-text-secondary hover:text-text hover:bg-surface-2"
                )}
              >
                <span>{d}</span>
                <span className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-surface border border-border/60">
                  {diffCounts[d] ?? 0}
                </span>
              </button>
            ))}
          </div>

          {/* Status */}
          <div className="space-y-1">
            <div className="px-2.5 text-[11px] font-mono font-medium uppercase tracking-wider text-text-secondary/70">
              Status
            </div>
            {(["Not started", "In progress", "Solved"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatus(status === s ? "all" : s)}
                className={cn(
                  "w-full flex items-center justify-between px-3 py-1.5 rounded-lg text-xs font-medium transition-colors text-left",
                  status === s
                    ? "bg-accent-soft text-accent font-semibold"
                    : "text-text-secondary hover:text-text hover:bg-surface-2"
                )}
              >
                <span>{s}</span>
                <span className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-surface border border-border/60">
                  {statusCounts[s]}
                </span>
              </button>
            ))}
          </div>

          {/* Time Budget Card */}
          <div className="rounded-xl border border-border bg-surface p-4 shadow-sm hover:border-border/80 transition-all">
            <h4 className="text-[11px] font-mono font-medium uppercase tracking-wider text-text-secondary/70 mb-3">
              Time budget
            </h4>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <b className="block font-mono text-base font-semibold text-text">{formatMinutes(totalMinutes)}</b>
                <span className="text-[11px] text-text-secondary">Total</span>
              </div>
              <div>
                <b className="block font-mono text-base font-semibold text-pass">{formatMinutes(doneMinutes)}</b>
                <span className="text-[11px] text-text-secondary">Done</span>
              </div>
              <div>
                <b className="block font-mono text-base font-semibold text-text-secondary">
                  {formatMinutes(Math.max(0, totalMinutes - doneMinutes))}
                </b>
                <span className="text-[11px] text-text-secondary">Left</span>
              </div>
            </div>
          </div>

          {/* Recent Activity Card */}
          <div className="rounded-xl border border-border bg-surface p-4 shadow-sm hover:border-border/80 transition-all">
            <h4 className="text-[11px] font-mono font-medium uppercase tracking-wider text-text-secondary/70 mb-2.5">
              Recent activity
            </h4>
            {userSubmissions.length === 0 ? (
              <p className="text-xs text-text-secondary/70 italic py-1">No submissions yet.</p>
            ) : (
              <div className="divide-y divide-border/60">
                {userSubmissions.slice(0, 4).map((sub) => (
                  <div key={sub.id} className="py-2 flex items-center justify-between gap-2 text-xs">
                    <span className="truncate text-text font-medium" title={sub.problemTitle}>
                      {sub.problemTitle}
                    </span>
                    <span
                      className={cn(
                        "font-mono text-[10px] px-1.5 py-0.5 rounded font-medium flex-none",
                        sub.result === "accepted"
                          ? "bg-pass-soft text-pass border border-pass/30"
                          : "bg-warning-soft text-warning border border-warning/30"
                      )}
                    >
                      {sub.result === "accepted" ? "Accepted" : "Failed"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>

        {/* ── Main Catalog Column ── */}
        <main className="min-w-0 space-y-5">
          {/* Header Title */}
          <div>
            <h1 className="font-serif text-3xl font-semibold tracking-tight text-text">Problem Catalogue</h1>
            <p className="mt-1 font-mono text-xs text-text-secondary">
              <span className="font-semibold text-text">{problems.length}</span> problems ·{" "}
              <span className="font-semibold text-text">{allTracks.length}</span> tracks —{" "}
              {allTracks.join(", ")} · <span className="text-pass font-semibold">{solvedCount}</span> solved
            </p>
          </div>

          {/* Quick Stats Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="rounded-xl border border-border bg-surface p-4 shadow-sm hover:-translate-y-0.5 hover:shadow transition-all">
              <b className="block font-mono text-2xl font-semibold text-text">
                <AnimatedNumber value={problems.length} />
              </b>
              <span className="text-xs text-text-secondary">Problems</span>
            </div>
            <div className="rounded-xl border border-border bg-surface p-4 shadow-sm hover:-translate-y-0.5 hover:shadow transition-all">
              <b className="block font-mono text-2xl font-semibold text-text">
                <AnimatedNumber value={allTracks.length} />
              </b>
              <span className="text-xs text-text-secondary">Tracks</span>
            </div>
            <div className="rounded-xl border border-border bg-surface p-4 shadow-sm hover:-translate-y-0.5 hover:shadow transition-all">
              <b className="block font-mono text-2xl font-semibold text-pass">
                <AnimatedNumber value={solvedCount} />
              </b>
              <span className="text-xs text-text-secondary">Solved</span>
            </div>
            <div className="rounded-xl border border-border bg-surface p-4 shadow-sm hover:-translate-y-0.5 hover:shadow transition-all">
              <b className="block font-mono text-2xl font-semibold text-text">{formatMinutes(totalMinutes)}</b>
              <span className="text-xs text-text-secondary">Total est. time</span>
            </div>
          </div>

          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-2.5">
            {/* Search Input */}
            <div className="relative flex-1 min-w-[220px]">
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search problems, skills, or tracks…"
                className="w-full rounded-xl border border-border bg-surface px-3.5 py-2 text-xs text-text placeholder:text-text-secondary/50 focus:outline-none focus:ring-1 focus:ring-accent focus:border-accent transition-all shadow-sm"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-text-secondary hover:text-text font-mono"
                >
                  ✕
                </button>
              )}
            </div>

            {/* Sort Select */}
            <select
              value={sortOption}
              onChange={(e) => setSortOption(e.target.value as SortOption)}
              className="rounded-xl border border-border bg-surface px-3 py-2 text-xs font-mono text-text focus:outline-none focus:ring-1 focus:ring-accent focus:border-accent transition-all shadow-sm cursor-pointer"
            >
              <option value="default">Default order</option>
              <option value="time">Shortest first</option>
              <option value="title">Title A–Z</option>
            </select>

            {/* View Popover Toggle */}
            <div className="relative" ref={viewDropdownRef}>
              <button
                type="button"
                onClick={() => setViewDropdownOpen((prev) => !prev)}
                className="rounded-xl border border-border bg-surface px-3.5 py-2 text-xs font-mono text-text hover:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent transition-all shadow-sm flex items-center gap-1.5"
              >
                <span>View</span>
                <span className="text-[10px] text-text-secondary">▾</span>
              </button>

              {viewDropdownOpen && (
                <div className="absolute right-0 top-full mt-2 w-52 rounded-xl border border-border bg-surface p-3 shadow-xl z-30 space-y-3 animate-in fade-in zoom-in-95 duration-150">
                  <div>
                    <div className="text-[10px] font-mono uppercase tracking-wider text-text-secondary/70 mb-1.5">
                      Density
                    </div>
                    <div className="grid grid-cols-2 gap-1 bg-surface-2 p-1 rounded-lg">
                      <button
                        type="button"
                        onClick={() => updateViewOptions({ dense: false })}
                        className={cn(
                          "py-1 text-xs rounded font-medium transition-colors",
                          !viewOptions.dense
                            ? "bg-surface text-text shadow-sm"
                            : "text-text-secondary hover:text-text"
                        )}
                      >
                        Comfortable
                      </button>
                      <button
                        type="button"
                        onClick={() => updateViewOptions({ dense: true })}
                        className={cn(
                          "py-1 text-xs rounded font-medium transition-colors",
                          viewOptions.dense
                            ? "bg-surface text-text shadow-sm"
                            : "text-text-secondary hover:text-text"
                        )}
                      >
                        Compact
                      </button>
                    </div>
                  </div>

                  <div className="space-y-1.5 border-t border-border pt-2.5">
                    <div className="text-[10px] font-mono uppercase tracking-wider text-text-secondary/70 mb-1">
                      Show
                    </div>
                    <label className="flex items-center gap-2 text-xs text-text cursor-pointer hover:text-accent">
                      <input
                        type="checkbox"
                        checked={viewOptions.skills}
                        onChange={(e) => updateViewOptions({ skills: e.target.checked })}
                        className="rounded border-border accent-accent"
                      />
                      <span>Skill tags</span>
                    </label>
                    <label className="flex items-center gap-2 text-xs text-text cursor-pointer hover:text-accent">
                      <input
                        type="checkbox"
                        checked={viewOptions.track}
                        onChange={(e) => updateViewOptions({ track: e.target.checked })}
                        className="rounded border-border accent-accent"
                      />
                      <span>Track line</span>
                    </label>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Horizontal Skill Filter Chips Bar */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none" style={{ scrollbarWidth: "none" }}>
            <button
              type="button"
              onClick={() => setSkill("all")}
              className={cn(
                "px-3 py-1 rounded-full text-xs font-mono font-medium transition-all flex-none",
                skill === "all"
                  ? "bg-accent text-white shadow-sm"
                  : "bg-surface text-text-secondary border border-border hover:border-accent/40 hover:text-accent"
              )}
            >
              All
            </button>
            {allSkills.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSkill(skill === s ? "all" : s)}
                className={cn(
                  "px-3 py-1 rounded-full text-xs font-mono font-medium transition-all flex-none flex items-center gap-1.5",
                  skill === s
                    ? "bg-accent text-white shadow-sm"
                    : "bg-surface text-text-secondary border border-border hover:border-accent/40 hover:text-accent"
                )}
              >
                <span>{s}</span>
                <span
                  className={cn(
                    "text-[10px]",
                    skill === s ? "text-white/80" : "text-text-secondary/60"
                  )}
                >
                  {skillCounts[s] ?? 0}
                </span>
              </button>
            ))}
          </div>

          {/* Problems Table Card */}
          <div className="rounded-xl border border-border bg-surface overflow-hidden shadow-sm">
            {/* Table Header */}
            <div className="grid grid-cols-[36px_minmax(0,1fr)_110px_60px_100px_36px] items-center gap-3 px-4 py-2.5 bg-surface-2 border-b border-border text-[11px] font-mono uppercase tracking-wider text-text-secondary/70 font-medium">
              <span className="w-5" />
              <span>Problem</span>
              <span className="text-left">Difficulty</span>
              <span className="text-right">Est.</span>
              <span className="text-right">Status</span>
              <span className="w-7 text-right" />
            </div>

            {/* Loading & Error States */}
            {isLoadingProblems && (
              <div className="divide-y divide-border/60 animate-pulse">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="h-16 bg-surface px-4 py-3 flex items-center gap-3">
                    <div className="h-5 w-5 rounded-full bg-surface-2" />
                    <div className="flex-1 space-y-1.5">
                      <div className="h-3.5 w-48 rounded bg-surface-2" />
                      <div className="h-2.5 w-32 rounded bg-surface-2" />
                    </div>
                    <div className="h-4 w-16 rounded bg-surface-2" />
                    <div className="h-4 w-10 rounded bg-surface-2" />
                    <div className="h-4 w-16 rounded bg-surface-2" />
                  </div>
                ))}
              </div>
            )}

            {isError && (
              <div className="p-8 text-center text-fail font-mono text-xs">
                Could not load problems: {(error as Error).message}
              </div>
            )}

            {/* Empty State */}
            {!isLoadingProblems && !isError && filteredProblems.length === 0 && (
              <div className="p-12 text-center text-text-secondary space-y-1">
                <p className="text-sm font-medium text-text">No problems match these filters.</p>
                <p className="text-xs text-text-secondary">Try resetting your search query or tag filters.</p>
                <button
                  type="button"
                  onClick={() => {
                    setTrack("all");
                    setDifficulty("all");
                    setSkill("all");
                    setStatus("all");
                    setSearchQuery("");
                  }}
                  className="mt-3 inline-flex items-center text-xs font-mono text-accent hover:underline"
                >
                  Clear all filters
                </button>
              </div>
            )}

            {/* Problem Rows */}
            {!isLoadingProblems && !isError && filteredProblems.length > 0 && (
              <div className="divide-y divide-border">
                {filteredProblems.map((p, idx) => {
                  const probStatus = getProblemStatus(p);
                  const isDone = probStatus === "Solved";
                  const isInProgress = probStatus === "In progress";

                  return (
                    <div
                      key={p.id}
                      className={cn(
                        "group relative grid grid-cols-[36px_minmax(0,1fr)_110px_60px_100px_36px] items-center gap-3 px-4 transition-colors cursor-pointer",
                        viewOptions.dense ? "py-2.5" : "py-3.5",
                        isDone ? "bg-pass-soft/10 hover:bg-pass-soft/20" : "hover:bg-surface-2/60",
                        // Left vertical accent bar on hover
                        "before:absolute before:left-0 before:top-2 before:bottom-2 before:w-[3px] before:rounded-r before:bg-accent before:scale-y-0 hover:before:scale-y-100 before:transition-transform before:duration-150"
                      )}
                      onClick={() => router.push(`/problems/${p.slug}`)}
                    >
                      {/* Solve indicator */}
                      <div className="flex items-center justify-center">
                        <SolveIndicator solved={p.solved} inProgress={isInProgress} />
                      </div>

                      {/* Title & Tags */}
                      <div className="min-w-0 pr-2">
                        <Link
                          href={`/problems/${p.slug}`}
                          onClick={(e) => e.stopPropagation()}
                          className="font-medium text-sm text-text hover:text-accent transition-colors truncate block"
                        >
                          {p.title}
                        </Link>

                        {/* Skill Tags */}
                        {viewOptions.skills && p.skills.length > 0 && (
                          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                            {p.skills.map((s) => (
                              <button
                                key={s}
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSkill(skill === s ? "all" : s);
                                }}
                                className={cn(
                                  "font-mono text-[10px] px-1.5 py-0.5 rounded transition-colors",
                                  skill === s
                                    ? "bg-accent text-white"
                                    : "bg-accent-soft text-accent hover:bg-accent/20"
                                )}
                              >
                                {s}
                              </button>
                            ))}
                          </div>
                        )}

                        {/* Track Line */}
                        {viewOptions.track && (
                          <div className="font-mono text-[11px] text-text-secondary/70 mt-1 capitalize">
                            track / {p.track}
                          </div>
                        )}
                      </div>

                      {/* Difficulty */}
                      <div>
                        <DifficultyBadge difficulty={p.difficulty} />
                      </div>

                      {/* Estimated time */}
                      <div className="text-right font-mono text-xs text-text-secondary tabular-nums">
                        {p.estMinutes}m
                      </div>

                      {/* Status */}
                      <div className="text-right">
                        <span
                          className={cn(
                            "inline-flex items-center gap-1.5 font-mono text-xs",
                            isDone ? "text-pass font-semibold" : isInProgress ? "text-warning" : "text-text-secondary"
                          )}
                        >
                          <span
                            className={cn(
                              "h-1.5 w-1.5 rounded-full",
                              isDone ? "bg-pass" : isInProgress ? "bg-warning" : "bg-text-secondary/40"
                            )}
                          />
                          {probStatus}
                        </span>
                      </div>

                      {/* More ⋯ options */}
                      <div className="flex justify-end">
                        <button
                          type="button"
                          data-more-trigger
                          onClick={(e) => {
                            e.stopPropagation();
                            const rect = e.currentTarget.getBoundingClientRect();
                            setMenuPos({ top: rect.bottom + window.scrollY + 4, left: Math.max(16, rect.right - 180) });
                            setActiveMenuProblem(activeMenuProblem?.id === p.id ? null : p);
                          }}
                          className="h-7 w-7 rounded-lg text-text-secondary hover:text-text hover:bg-surface-2 flex items-center justify-center font-bold text-base transition-colors"
                          title="More actions"
                        >
                          ⋯
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </main>

        {/* ── Right Rail (Calendar, Up Next, Progress, Streak, Track Progress) ── */}
        <aside className="space-y-5 lg:sticky lg:top-20">
          {/* Calendar Card */}
          <div className="rounded-xl border border-border bg-surface p-4 shadow-sm hover:border-border/80 transition-all">
            <div className="flex items-center justify-between mb-3">
              <b className="font-mono text-xs font-semibold text-text">
                {calMonth.toLocaleString("en", { month: "long", year: "numeric" })}
              </b>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setCalMonth(new Date(calMonth.getFullYear(), calMonth.getMonth() - 1, 1))}
                  className="h-6 w-6 rounded border border-border bg-surface-2 flex items-center justify-center text-xs text-text-secondary hover:text-text"
                  title="Previous month"
                >
                  ‹
                </button>
                <button
                  type="button"
                  onClick={() => setCalMonth(new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 1))}
                  className="h-6 w-6 rounded border border-border bg-surface-2 flex items-center justify-center text-xs text-text-secondary hover:text-text"
                  title="Next month"
                >
                  ›
                </button>
              </div>
            </div>

            {/* Days of week */}
            <div className="grid grid-cols-7 gap-1 text-center font-mono text-[10px] text-text-secondary/70 mb-1">
              {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
                <div key={i} className="py-0.5">
                  {d}
                </div>
              ))}
            </div>

            {/* Month grid */}
            {(() => {
              const y = calMonth.getFullYear();
              const m = calMonth.getMonth();
              const todayStr = new Date().toDateString();
              const firstDayIndex = new Date(y, m, 1).getDay();
              const totalDays = new Date(y, m + 1, 0).getDate();

              let activeDaysThisMonth = 0;
              const days = [];

              for (let i = 0; i < firstDayIndex; i++) {
                days.push(<div key={`blank-${i}`} />);
              }

              for (let d = 1; d <= totalDays; d++) {
                const dt = new Date(y, m, d);
                const dtStr = dt.toDateString();
                const daySubs = subsByDay.get(dtStr) || [];
                const isAccepted = daySubs.some((s) => s.result === "accepted");
                const isAttempted = daySubs.length > 0 && !isAccepted;
                const isToday = dtStr === todayStr;
                const isSelected = selectedCalDay === dtStr;

                if (daySubs.length > 0) activeDaysThisMonth++;

                days.push(
                  <button
                    key={`d-${d}`}
                    type="button"
                    onClick={() => setSelectedCalDay(isSelected ? null : dtStr)}
                    className={cn(
                      "relative h-7 w-full rounded-md font-mono text-xs flex items-center justify-center transition-colors",
                      isToday
                        ? "bg-accent text-white font-semibold"
                        : isSelected
                        ? "bg-accent-soft text-accent ring-1 ring-accent"
                        : "text-text-secondary hover:bg-surface-2"
                    )}
                  >
                    {d}
                    {/* Activity dot marker */}
                    {isAccepted && (
                      <span className="absolute bottom-0.5 h-1 w-1 rounded-full bg-pass" />
                    )}
                    {isAttempted && (
                      <span className="absolute bottom-0.5 h-1 w-1 rounded-full bg-warning" />
                    )}
                  </button>
                );
              }

              return (
                <>
                  <div className="grid grid-cols-7 gap-1">{days}</div>
                  <div className="mt-2.5 font-mono text-[11px] text-text-secondary/80 flex items-center justify-between">
                    <span>{activeDaysThisMonth} active day{activeDaysThisMonth === 1 ? "" : "s"} this month</span>
                  </div>
                </>
              );
            })()}

            {/* Legend */}
            <div className="mt-2 pt-2 border-t border-border flex items-center gap-3 font-mono text-[10px] text-text-secondary">
              <span className="flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-pass" />
                Accepted
              </span>
              <span className="flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-warning" />
                Attempted
              </span>
            </div>

            {/* Selected day activity detail */}
            {selectedCalDay && (
              <div className="mt-2.5 pt-2.5 border-t border-border space-y-1.5 text-xs animate-in fade-in duration-150">
                <div className="font-mono text-[11px] text-text-secondary">
                  {new Date(selectedCalDay).toLocaleDateString("en", { month: "short", day: "numeric" })} submissions:
                </div>
                {(subsByDay.get(selectedCalDay) || []).length === 0 ? (
                  <p className="text-[11px] text-text-secondary/70 italic">No submissions on this day.</p>
                ) : (
                  (subsByDay.get(selectedCalDay) || []).map((s) => (
                    <div key={s.id} className="flex items-center justify-between gap-1 text-[11px]">
                      <span className="truncate text-text">{s.problemTitle}</span>
                      <span className={cn("font-mono", s.result === "accepted" ? "text-pass" : "text-warning")}>
                        {s.result === "accepted" ? "Pass" : "Fail"}
                      </span>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

          {/* Up Next Card */}
          <div className="rounded-xl border border-border bg-surface p-4 shadow-sm hover:border-border/80 transition-all">
            <h4 className="text-[11px] font-mono font-medium uppercase tracking-wider text-text-secondary/70 mb-2">
              Up next
            </h4>
            {nextUnsolvedProblem ? (
              <div className="space-y-2">
                <Link
                  href={`/problems/${nextUnsolvedProblem.slug}`}
                  className="font-medium text-sm text-text hover:text-accent transition-colors line-clamp-2 block"
                >
                  {nextUnsolvedProblem.title}
                </Link>
                <div className="flex items-center gap-1 flex-wrap">
                  {nextUnsolvedProblem.skills.slice(0, 2).map((s) => (
                    <span key={s} className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-accent-soft text-accent">
                      {s}
                    </span>
                  ))}
                </div>
                <div className="flex items-center justify-between pt-1">
                  <div className="flex items-center gap-2">
                    <DifficultyBadge difficulty={nextUnsolvedProblem.difficulty} />
                    <span className="font-mono text-xs text-text-secondary">{nextUnsolvedProblem.estMinutes}m</span>
                  </div>
                  <Link
                    href={`/problems/${nextUnsolvedProblem.slug}`}
                    className="text-xs font-mono font-medium text-accent hover:underline flex items-center gap-0.5"
                  >
                    Start →
                  </Link>
                </div>
              </div>
            ) : (
              <p className="text-xs text-pass font-medium py-1">Every problem is solved! 🎉</p>
            )}
          </div>

          {/* Progress Card */}
          <div className="rounded-xl border border-border bg-surface p-4 shadow-sm hover:border-border/80 transition-all space-y-3">
            <h4 className="text-[11px] font-mono font-medium uppercase tracking-wider text-text-secondary/70">
              Progress
            </h4>
            <div className="flex items-center gap-3.5">
              <ProgressRing percent={overallPercent} />
              <div className="font-mono text-xs text-text-secondary">
                <span className="font-semibold text-text">{solvedCount}</span> / {totalCount} solved
              </div>
            </div>
            <div className="space-y-0.5 border-t border-border pt-2">
              {(["easy", "medium", "hard"] as const).map((d) => (
                <MeterBar
                  key={d}
                  label={d}
                  current={problems.filter((p) => p.difficulty === d && p.solved === true).length}
                  total={diffCounts[d] ?? 0}
                />
              ))}
            </div>
          </div>

          {/* Streak Card */}
          <div className="rounded-xl border border-border bg-surface p-4 shadow-sm hover:border-border/80 transition-all">
            <h4 className="text-[11px] font-mono font-medium uppercase tracking-wider text-text-secondary/70 mb-3">
              Streak
            </h4>
            <div className="grid grid-cols-3 gap-2 text-center font-mono">
              <div>
                <b className="block text-base font-semibold text-text">{streakStats.cur}</b>
                <span className="text-[11px] text-text-secondary">Current</span>
              </div>
              <div>
                <b className="block text-base font-semibold text-text">{streakStats.best}</b>
                <span className="text-[11px] text-text-secondary">Best</span>
              </div>
              <div>
                <b className="block text-base font-semibold text-accent">
                  {streakStats.solvedSkillsCount}/{streakStats.allSkillsCount}
                </b>
                <span className="text-[11px] text-text-secondary">Skills</span>
              </div>
            </div>
          </div>

          {/* Track Progress Card */}
          <div className="rounded-xl border border-border bg-surface p-4 shadow-sm hover:border-border/80 transition-all space-y-2">
            <h4 className="text-[11px] font-mono font-medium uppercase tracking-wider text-text-secondary/70">
              Track progress
            </h4>
            <div className="space-y-0.5">
              {allTracks.map((t) => (
                <MeterBar
                  key={t}
                  label={t}
                  current={problems.filter((p) => p.track === t && p.solved === true).length}
                  total={trackCounts[t] ?? 0}
                />
              ))}
            </div>
          </div>
        </aside>
      </div>

      {/* ── More ⋯ Floating Menu ── */}
      {activeMenuProblem && menuPos && (
        <div
          className="fixed z-50 w-48 rounded-xl border border-border bg-surface p-1 shadow-2xl space-y-0.5 animate-in fade-in zoom-in-95 duration-100"
          style={{ top: menuPos.top, left: menuPos.left }}
        >
          <button
            type="button"
            onClick={() => {
              router.push(`/problems/${activeMenuProblem.slug}`);
              setActiveMenuProblem(null);
            }}
            className="w-full text-left px-3 py-1.5 rounded-lg text-xs text-text hover:bg-surface-2 transition-colors"
          >
            Open problem
          </button>
          <button
            type="button"
            onClick={() => {
              const url = `${window.location.origin}/problems/${activeMenuProblem.slug}`;
              navigator.clipboard?.writeText(url);
              showToast("Link copied to clipboard");
              setActiveMenuProblem(null);
            }}
            className="w-full text-left px-3 py-1.5 rounded-lg text-xs text-text hover:bg-surface-2 transition-colors"
          >
            Copy link
          </button>
          <button
            type="button"
            onClick={() => {
              setTrack(activeMenuProblem.track);
              setActiveMenuProblem(null);
            }}
            className="w-full text-left px-3 py-1.5 rounded-lg text-xs text-text hover:bg-surface-2 transition-colors capitalize"
          >
            Show track: {activeMenuProblem.track}
          </button>
          {activeMenuProblem.skills.slice(0, 2).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                setSkill(s);
                setActiveMenuProblem(null);
              }}
              className="w-full text-left px-3 py-1.5 rounded-lg text-xs text-text hover:bg-surface-2 transition-colors"
            >
              Filter skill: {s}
            </button>
          ))}
        </div>
      )}

      {/* ── Toast Notification ── */}
      <AnimatePresence>
        {toastMsg && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 rounded-xl border border-border bg-surface px-4 py-2.5 shadow-2xl text-xs font-mono text-text flex items-center gap-2"
          >
            <span className="h-2 w-2 rounded-full bg-pass" />
            {toastMsg}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Footer ── */}
      <footer className="border-t border-border mt-12 bg-surface/50">
        <div className="mx-auto max-w-[1440px] px-4 sm:px-6 py-4 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs font-mono text-text-secondary/70">
          <span>Showing all {problems.length} problems in the database.</span>
          <div className="flex items-center gap-4">
            <span>© Heisenbug</span>
            <Link href="/problems" className="hover:text-text transition-colors">
              Catalogue
            </Link>
            <Link href="/dashboard" className="hover:text-text transition-colors">
              My Progress
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
