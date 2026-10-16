"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useState, useMemo } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import {
  fetchUserSessions,
  fetchProblems,
  createSession,
  getActiveToken,
  setAuthToken,
  fetchCurrentUser,
  requestRecruiterAccess,
  type Session,
  type Problem,
  type Submission,
} from "@/lib/api";
import { DifficultyBadge, TrackBadge } from "@/components/badge";
import { cn } from "@/lib/utils";

// ── Helpers ────────────────────────────────────────────────────────────────

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

// ── Solved Arc Gauge Card ──────────────────────────────────────────────────

interface SolvedArcCardProps {
  totalProblems: number;
  solvedTotal: number;
  attemptingTotal: number;
  easy: { solved: number; total: number };
  med: { solved: number; total: number };
  hard: { solved: number; total: number };
}

function SolvedArcCard({
  totalProblems,
  solvedTotal,
  attemptingTotal,
  easy,
  med,
  hard,
}: SolvedArcCardProps) {
  // Gauge arc parameters: circle r=60, C ≈ 376.99
  // 260-degree arc: length = 272.27, gap = 104.72
  const C = 376.99;
  const arcLength = 272.27;
  const gap = 104.72;

  const totalSafe = totalProblems > 0 ? totalProblems : 1;
  const easyArc = (easy.solved / totalSafe) * arcLength;
  const medArc = (med.solved / totalSafe) * arcLength;
  const hardArc = (hard.solved / totalSafe) * arcLength;

  return (
    <div className="rounded-xl border border-border bg-surface p-5 shadow-sm hover:border-border/80 transition-all flex flex-col justify-between">
      <div className="flex items-center justify-between gap-4">
        {/* Arc Gauge */}
        <div className="relative w-40 h-40 flex items-center justify-center flex-none">
          <svg viewBox="0 0 160 160" className="w-full h-full transform rotate-[140deg]">
            {/* Background Track */}
            <circle
              cx="80"
              cy="80"
              r="60"
              fill="none"
              stroke="currentColor"
              strokeWidth="9"
              strokeLinecap="round"
              strokeDasharray={`${arcLength} ${gap}`}
              className="text-surface-2 dark:text-[#202937]"
            />

            {/* Easy Segment */}
            {easyArc > 0 && (
              <circle
                cx="80"
                cy="80"
                r="60"
                fill="none"
                stroke="#2dd4bf"
                strokeWidth="9"
                strokeLinecap="round"
                strokeDasharray={`${easyArc} ${C - easyArc}`}
                strokeDashoffset="0"
                className="transition-all duration-700 ease-out"
              />
            )}

            {/* Medium Segment */}
            {medArc > 0 && (
              <circle
                cx="80"
                cy="80"
                r="60"
                fill="none"
                stroke="#fbbf24"
                strokeWidth="9"
                strokeLinecap={hardArc > 0 ? "butt" : "round"}
                strokeDasharray={`${medArc} ${C - medArc}`}
                strokeDashoffset={-easyArc}
                className="transition-all duration-700 ease-out"
              />
            )}

            {/* Hard Segment */}
            {hardArc > 0 && (
              <circle
                cx="80"
                cy="80"
                r="60"
                fill="none"
                stroke="#f87171"
                strokeWidth="9"
                strokeLinecap="round"
                strokeDasharray={`${hardArc} ${C - hardArc}`}
                strokeDashoffset={-(easyArc + medArc)}
                className="transition-all duration-700 ease-out"
              />
            )}
          </svg>

          {/* Center Text */}
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none select-none text-center">
            <div className="text-2xl font-bold font-mono text-text tracking-tight">
              {solvedTotal}
              <span className="text-xs font-normal text-text-secondary/80">/{totalProblems}</span>
            </div>
            <div className="text-xs font-medium text-pass flex items-center justify-center gap-1 mt-0.5">
              <span>✓</span> Solved
            </div>
            <div className="text-[11px] font-mono text-text-secondary/70 mt-1">
              {attemptingTotal} Attempting
            </div>
          </div>
        </div>

        {/* Breakdown Stack */}
        <div className="flex-1 space-y-2 max-w-[150px]">
          {/* Easy */}
          <div className="rounded-lg bg-surface-2/60 border border-border/40 p-2 text-center">
            <div className="text-[11px] font-semibold text-[#0d9488] dark:text-[#2dd4bf] font-mono">Easy</div>
            <div className="text-xs font-mono font-medium text-text mt-0.5">
              {easy.solved}/{easy.total}
            </div>
          </div>

          {/* Medium */}
          <div className="rounded-lg bg-surface-2/60 border border-border/40 p-2 text-center">
            <div className="text-[11px] font-semibold text-[#d97706] dark:text-[#fbbf24] font-mono">Med.</div>
            <div className="text-xs font-mono font-medium text-text mt-0.5">
              {med.solved}/{med.total}
            </div>
          </div>

          {/* Hard */}
          <div className="rounded-lg bg-surface-2/60 border border-border/40 p-2 text-center">
            <div className="text-[11px] font-semibold text-[#dc2626] dark:text-[#f87171] font-mono">Hard</div>
            <div className="text-xs font-mono font-medium text-text mt-0.5">
              {hard.solved}/{hard.total}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Badges Card ────────────────────────────────────────────────────────────

interface BadgeItem {
  id: string;
  title: string;
  desc: string;
  unlocked: boolean;
  unlockedAt?: string;
  iconType: "bug" | "century" | "streak" | "polyglot";
}

function BadgeIcon({ type, unlocked }: { type: BadgeItem["iconType"]; unlocked: boolean }) {
  if (type === "bug") {
    return (
      <div
        className={cn(
          "w-14 h-14 rounded-2xl flex items-center justify-center transition-all shadow-sm",
          unlocked
            ? "bg-gradient-to-br from-cyan-500/20 to-teal-600/30 border-2 border-teal-500/60 text-teal-400 ring-2 ring-teal-500/20"
            : "bg-surface-2 border border-border text-text-secondary/40 opacity-50"
        )}
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="m8 2 1.88 1.88M14.12 3.88 16 2M9 7.13v-1a3.003 3.003 0 1 1 6 0v1" />
          <path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6" />
          <path d="M12 20v-9M6.53 9C4.6 8.8 3 7.1 3 5M6 13H2M3 21c0-2.1 1.7-3.9 3.8-4M20.97 5c0 2.1-1.6 3.8-3.5 4M22 13h-4M17.2 17c2.1.1 3.8 1.9 3.8 4" />
        </svg>
      </div>
    );
  }
  if (type === "century") {
    return (
      <div
        className={cn(
          "w-14 h-14 rounded-2xl flex items-center justify-center transition-all shadow-sm",
          unlocked
            ? "bg-gradient-to-br from-purple-500/20 to-violet-600/30 border-2 border-purple-500/60 text-purple-400 ring-2 ring-purple-500/20"
            : "bg-surface-2 border border-border text-text-secondary/40 opacity-50"
        )}
      >
        <span className="font-mono font-bold text-sm tracking-tighter">100</span>
      </div>
    );
  }
  if (type === "streak") {
    return (
      <div
        className={cn(
          "w-14 h-14 rounded-2xl flex items-center justify-center transition-all shadow-sm",
          unlocked
            ? "bg-gradient-to-br from-amber-500/20 to-orange-600/30 border-2 border-amber-500/60 text-amber-400 ring-2 ring-amber-500/20"
            : "bg-surface-2 border border-border text-text-secondary/40 opacity-50"
        )}
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
        </svg>
      </div>
    );
  }
  return (
    <div
      className={cn(
        "w-14 h-14 rounded-2xl flex items-center justify-center transition-all shadow-sm",
        unlocked
          ? "bg-gradient-to-br from-indigo-500/20 to-blue-600/30 border-2 border-indigo-500/60 text-indigo-400 ring-2 ring-indigo-500/20"
          : "bg-surface-2 border border-border text-text-secondary/40 opacity-50"
      )}
    >
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="10" />
        <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
      </svg>
    </div>
  );
}

function BadgesCard({ badges }: { badges: BadgeItem[] }) {
  const unlockedBadges = badges.filter((b) => b.unlocked);
  const mostRecent = unlockedBadges[unlockedBadges.length - 1];

  return (
    <div className="rounded-xl border border-border bg-surface p-5 shadow-sm hover:border-border/80 transition-all flex flex-col justify-between">
      <div>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs font-mono font-medium uppercase tracking-wider text-text-secondary/70">
              Badges
            </div>
            <div className="text-2xl font-bold font-mono text-text mt-0.5">
              {unlockedBadges.length}
            </div>
          </div>
          <Link
            href="/problems"
            className="text-text-secondary hover:text-accent transition-colors text-sm font-mono flex items-center gap-1"
          >
            Explore <span className="text-base leading-none">→</span>
          </Link>
        </div>

        {/* Badges Row */}
        <div className="flex items-center gap-3.5 mt-4 overflow-x-auto pb-1">
          {badges.map((b) => (
            <div key={b.id} className="group relative flex flex-col items-center flex-none" title={`${b.title}: ${b.desc}`}>
              <BadgeIcon type={b.iconType} unlocked={b.unlocked} />
              <span className="text-[10px] font-mono font-medium text-text mt-1.5 truncate max-w-[68px] text-center block">
                {b.title}
              </span>
              <span className="text-[9px] font-mono text-text-secondary/60">
                {b.unlocked ? "Earned" : "Locked"}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Most Recent Badge Footer */}
      <div className="mt-4 pt-3 border-t border-border/60">
        <div className="text-[10px] font-mono uppercase tracking-wider text-text-secondary/70">
          Most Recent Badge
        </div>
        <div className="text-xs font-medium text-text mt-0.5">
          {mostRecent ? (
            <span className="text-accent font-semibold">
              {mostRecent.title} {mostRecent.unlockedAt ? `(${new Date(mostRecent.unlockedAt).getFullYear()})` : ""}
            </span>
          ) : (
            <span className="text-text-secondary/70 italic">Submit code to unlock milestone badges</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Yearly Submissions Heatmap ─────────────────────────────────────────────

interface HeatmapDay {
  date: Date;
  key: string;
  count: number;
}

interface SubmissionHeatmapProps {
  submissions: Array<{ at: string }>;
  activeDays: number;
  maxStreak: number;
}

function SubmissionHeatmap({ submissions, activeDays, maxStreak }: SubmissionHeatmapProps) {
  // Group submissions by YYYY-MM-DD
  const countsByDay = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of submissions) {
      const d = new Date(s.at);
      if (!isNaN(d.getTime())) {
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        map.set(key, (map.get(key) ?? 0) + 1);
      }
    }
    return map;
  }, [submissions]);

  // Generate 52 weeks (364 days) up to today
  const { weeks, monthLabels } = useMemo(() => {
    const today = new Date();
    today.setHours(23, 59, 59, 999);

    // Start 52 weeks ago on Sunday
    const start = new Date(today);
    start.setDate(start.getDate() - 52 * 7 + (6 - today.getDay()));
    const startDay = start.getDay();
    start.setDate(start.getDate() - startDay);
    start.setHours(0, 0, 0, 0);

    const weeksList: HeatmapDay[][] = [];
    const months: Array<{ label: string; weekIndex: number }> = [];

    const curr = new Date(start);
    let currentWeek: HeatmapDay[] = [];
    let lastMonth = -1;

    while (curr <= today || currentWeek.length > 0) {
      const key = `${curr.getFullYear()}-${String(curr.getMonth() + 1).padStart(2, "0")}-${String(curr.getDate()).padStart(2, "0")}`;
      const isFuture = curr > today;
      const count = isFuture ? -1 : countsByDay.get(key) ?? 0;

      currentWeek.push({
        date: new Date(curr),
        key,
        count,
      });

      if (currentWeek.length === 7) {
        // Track month transition for label
        const firstDayOfMonthInWeek = currentWeek.find((d) => d.date.getDate() <= 7 && !isFuture);
        if (firstDayOfMonthInWeek) {
          const m = firstDayOfMonthInWeek.date.getMonth();
          if (m !== lastMonth) {
            months.push({
              label: firstDayOfMonthInWeek.date.toLocaleString("en", { month: "short" }),
              weekIndex: weeksList.length,
            });
            lastMonth = m;
          }
        }

        weeksList.push(currentWeek);
        currentWeek = [];
        if (curr > today) break;
      }

      curr.setDate(curr.getDate() + 1);
    }

    return { weeks: weeksList, monthLabels: months };
  }, [countsByDay]);

  const totalSubsCount = submissions.length;

  return (
    <div className="rounded-xl border border-border bg-surface p-5 shadow-sm space-y-4">
      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs font-mono">
        <div className="flex items-center gap-1.5">
          <span className="font-bold text-base text-text">{totalSubsCount}</span>
          <span className="text-text-secondary">submissions in the past one year</span>
          <span
            className="text-text-secondary/60 cursor-help"
            title="Only recorded solutions submitted via Run or Submit are counted. No synthetic submissions."
          >
            ⓘ
          </span>
        </div>

        <div className="flex items-center gap-4 text-text-secondary">
          <span>
            Total active days: <strong className="text-text font-semibold">{activeDays}</strong>
          </span>
          <span>
            Max streak: <strong className="text-text font-semibold">{maxStreak}</strong>
          </span>
          <span className="px-2 py-0.5 rounded border border-border bg-surface-2 text-text font-mono text-[11px]">
            Current ▾
          </span>
        </div>
      </div>

      {/* Heatmap Grid */}
      <div className="overflow-x-auto pb-1 scrollbar-none" style={{ scrollbarWidth: "none" }}>
        <div className="min-w-[700px]">
          {/* Day Grid */}
          <div className="flex gap-[3px]">
            {weeks.map((week, wIdx) => (
              <div key={wIdx} className="flex flex-col gap-[3px]">
                {week.map((day) => {
                  if (day.count === -1) {
                    return <div key={day.key} className="w-[11px] h-[11px] rounded-[2px] opacity-0" />;
                  }

                  let bgClass = "bg-surface-2 dark:bg-[#1a2330]";
                  if (day.count === 1) bgClass = "bg-pass/35";
                  else if (day.count === 2) bgClass = "bg-pass/65";
                  else if (day.count >= 3) bgClass = "bg-pass";

                  const formattedDate = day.date.toLocaleDateString("en", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  });

                  return (
                    <div
                      key={day.key}
                      title={`${day.count} submission${day.count === 1 ? "" : "s"} on ${formattedDate}`}
                      className={cn(
                        "w-[11px] h-[11px] rounded-[2px] transition-colors cursor-pointer hover:ring-1 hover:ring-accent",
                        bgClass
                      )}
                    />
                  );
                })}
              </div>
            ))}
          </div>

          {/* Month Labels along Bottom */}
          <div className="flex justify-between text-[10px] font-mono text-text-secondary/70 mt-2 px-1">
            {monthLabels.map((m, idx) => (
              <span key={`${m.label}-${idx}`}>{m.label}</span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main Candidate Dashboard Page ──────────────────────────────────────────

export default function CandidateDashboardPage() {
  const queryClient = useQueryClient();
  const [authed, setAuthed] = useState<boolean>(false);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    async function initAuth() {
      if (typeof window !== "undefined" && window.location.hash.includes("token=")) {
        const match = window.location.hash.match(/token=([^&]+)/);
        if (match && match[1]) {
          const token = decodeURIComponent(match[1]);
          setAuthToken(token);
          window.history.replaceState(null, "", window.location.pathname + (window.location.search || ""));
          queryClient.invalidateQueries({ queryKey: ["me"] });
          queryClient.invalidateQueries({ queryKey: ["sessions"] });
          setAuthed(true);
          return;
        }
      }

      const token = await getActiveToken();
      if (token) {
        setAuthed(true);
        return;
      }
      setAuthed(true);
    }
    initAuth();
  }, [queryClient]);

  const { data: currentUser } = useQuery({
    queryKey: ["me"],
    queryFn: fetchCurrentUser,
    enabled: authed,
  });

  const [recruiterMsg, setRecruiterMsg] = useState<string | null>(null);

  const requestRecruiterMutation = useMutation({
    mutationFn: requestRecruiterAccess,
    onSuccess: (res) => {
      setRecruiterMsg(res.message);
      queryClient.invalidateQueries({ queryKey: ["me"] });
    },
    onError: (err: any) => {
      setRecruiterMsg(err.message || "Failed to request recruiter access");
    },
  });

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

  const { data: problems = [], isLoading: isLoadingProblems } = useQuery({
    queryKey: ["problems"],
    queryFn: fetchProblems,
  });

  const createSessionMutation = useMutation({
    mutationFn: async () => {
      const targetProblem = problems[0];
      const versionId = targetProblem?.currentVersion?.id ?? "cmur7astv00021m2f7e8ll1sy";
      return createSession(versionId, "PRACTICE");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
  });

  const activeSession = sessions.find((s) => s.status === "ACTIVE");
  const reduce = useReducedMotion();

  // Extract all real user submissions
  const allSubmissions = useMemo<Array<{ id: string; at: string; score: number; confidencePct?: number | null; problemTitle: string }>>(() => {
    const list: Array<{ id: string; at: string; score: number; confidencePct?: number | null; problemTitle: string }> = [];
    for (const s of sessions) {
      const probTitle = s.version?.problem?.title ?? "Problem";
      if (s.submissions && s.submissions.length > 0) {
        for (const sub of s.submissions) {
          list.push({
            id: sub.id,
            at: sub.createdAt,
            score: sub.score,
            confidencePct: sub.confidencePct,
            problemTitle: probTitle,
          });
        }
      }
    }
    return list.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  }, [sessions]);

  // Solved and Attempting calculations (100% real)
  const totalProblems = problems.length;
  const solvedProblems = useMemo(() => problems.filter((p) => p.solved === true), [problems]);
  const solvedCount = solvedProblems.length;

  const attemptedProblemIds = useMemo(() => {
    const set = new Set<string>();
    for (const s of sessions) {
      const pId = s.version?.problem?.id;
      if (pId) set.add(pId);
    }
    return set;
  }, [sessions]);

  const attemptingCount = useMemo(() => {
    return problems.filter((p) => p.solved !== true && attemptedProblemIds.has(p.id)).length;
  }, [problems, attemptedProblemIds]);

  const easyStats = useMemo(() => {
    const total = problems.filter((p) => p.difficulty === "easy").length;
    const solved = solvedProblems.filter((p) => p.difficulty === "easy").length;
    return { solved, total };
  }, [problems, solvedProblems]);

  const medStats = useMemo(() => {
    const total = problems.filter((p) => p.difficulty === "medium").length;
    const solved = solvedProblems.filter((p) => p.difficulty === "medium").length;
    return { solved, total };
  }, [problems, solvedProblems]);

  const hardStats = useMemo(() => {
    const total = problems.filter((p) => p.difficulty === "hard").length;
    const solved = solvedProblems.filter((p) => p.difficulty === "hard").length;
    return { solved, total };
  }, [problems, solvedProblems]);

  // Streak & Active Days calculations
  const { activeDays, maxStreak } = useMemo(() => {
    const activeDayKeys = Array.from(
      new Set(
        allSubmissions.map((s) => {
          const d = new Date(s.at);
          return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        })
      )
    ).sort();

    const activeDays = activeDayKeys.length;
    let maxStreak = 0;
    let currentRun = 0;
    let prevTime: number | null = null;
    const ONE_DAY = 24 * 60 * 60 * 1000;

    for (const k of activeDayKeys) {
      const [y, m, d] = k.split("-").map(Number);
      const time = new Date(y, m - 1, d).getTime();
      if (prevTime !== null && Math.round((time - prevTime) / ONE_DAY) === 1) {
        currentRun++;
      } else {
        currentRun = 1;
      }
      prevTime = time;
      if (currentRun > maxStreak) maxStreak = currentRun;
    }

    return { activeDays, maxStreak };
  }, [allSubmissions]);

  // Badges derived from real milestones
  const badges = useMemo<BadgeItem[]>(() => {
    const hasSolvedAtLeastOne = solvedCount >= 1;
    const hasCentury = allSubmissions.some((s) => s.score === 100);
    const hasStreak3 = maxStreak >= 3;
    const tracksSolved = new Set(solvedProblems.map((p) => p.track)).size;
    const hasMultiTrack = tracksSolved >= 2;

    const list: BadgeItem[] = [
      {
        id: "first-bug",
        title: "Bug Hunter",
        desc: "Squash your first realistic production bug",
        unlocked: hasSolvedAtLeastOne,
        unlockedAt: solvedProblems[0]?.createdAt,
        iconType: "bug",
      },
      {
        id: "century",
        title: "100 Club",
        desc: "Pass 100% of visible and hidden tests on submission",
        unlocked: hasCentury,
        iconType: "century",
      },
      {
        id: "streak-3",
        title: "On Fire",
        desc: "Maintain a 3-day active solving streak",
        unlocked: hasStreak3,
        iconType: "streak",
      },
      {
        id: "polyglot",
        title: "Explorer",
        desc: "Solve problems across multiple tracks (backend, ml, security)",
        unlocked: hasMultiTrack,
        iconType: "polyglot",
      },
    ];

    return list;
  }, [solvedCount, allSubmissions, maxStreak, solvedProblems]);

  return (
    <div className="mx-auto max-w-[1440px] px-4 sm:px-6 py-8 space-y-7">
      {/* ── Top Header ── */}
      <motion.div
        initial={reduce ? false : { opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22 }}
        className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-5"
      >
        <div>
          <h1 className="font-serif text-3xl font-semibold text-text tracking-tight">Candidate Dashboard</h1>
          <p className="mt-1 text-sm text-text-secondary">
            Welcome back, <span className="font-medium text-text">{currentUser?.name || "Candidate"}</span> (
            <code className="font-mono text-xs">{currentUser?.email || "candidate@heisenbug.dev"}</code>)
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/problems"
            className="px-3.5 py-2 rounded-lg text-xs font-mono font-medium border border-border bg-surface hover:bg-surface-2 transition-colors"
          >
            Browse Catalogue
          </Link>
          <button
            onClick={() => createSessionMutation.mutate()}
            disabled={createSessionMutation.isPending || !problems.length}
            className={cn(
              "inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold font-mono shadow-sm",
              "bg-accent text-white hover:bg-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
              "disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            )}
          >
            {createSessionMutation.isPending ? "Creating session..." : "+ Create practice session"}
          </button>
        </div>
      </motion.div>

      {/* Recruiter Request Status Banner */}
      {currentUser?.role === "CANDIDATE" && (
        <div className="p-4 rounded-xl border border-border bg-surface-2/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
          <div>
            <div className="font-semibold text-text">Hiring Engineering Talent?</div>
            <div className="text-text-secondary mt-0.5">
              {currentUser.approvalStatus === "PENDING" ? (
                <span className="text-amber-500 font-medium">
                  Your request for recruiter access is currently pending administrator approval.
                </span>
              ) : currentUser.approvalStatus === "REJECTED" ? (
                <span className="text-fail">Your previous recruiter access request was rejected. You may request access again.</span>
              ) : (
                <span>Request recruiter access to create custom candidate assessments and evaluate engineers.</span>
              )}
            </div>
            {recruiterMsg && <div className="text-accent mt-1 font-mono">{recruiterMsg}</div>}
          </div>
          {currentUser.approvalStatus !== "PENDING" && (
            <button
              onClick={() => requestRecruiterMutation.mutate()}
              disabled={requestRecruiterMutation.isPending}
              className="px-3 py-1.5 rounded-lg bg-accent text-white font-medium hover:bg-accent/90 disabled:opacity-50 shrink-0 transition-colors font-mono"
            >
              {requestRecruiterMutation.isPending ? "Requesting..." : "Request Recruiter Access"}
            </button>
          )}
        </div>
      )}

      {authError && (
        <div className="rounded-xl border border-fail/40 bg-fail-soft px-4 py-3 text-sm text-fail font-mono">
          Auth Error: {authError}
        </div>
      )}

      {/* ── Active Session Banner ── */}
      <AnimatePresence>
        {activeSession && activeSession.version?.problem && (
          <motion.div
            initial={reduce ? false : { opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.97 }}
            transition={{ duration: 0.2 }}
            className="rounded-xl border-2 border-accent/40 bg-accent-soft/20 p-5 space-y-3"
          >
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold font-mono bg-accent text-white">
                <span className="h-2 w-2 rounded-full bg-white animate-pulse" />
                Active Session
              </span>
              <span className="text-xs text-text-secondary font-mono">
                Started {new Date(activeSession.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-bold text-text">{activeSession.version.problem.title}</h2>
                <div className="mt-1 flex items-center gap-2">
                  <TrackBadge track={activeSession.version.problem.track} />
                  <DifficultyBadge difficulty={activeSession.version.problem.difficulty} />
                  <span className="text-xs text-text-secondary font-mono">Mode: {activeSession.mode}</span>
                </div>
              </div>

              <Link
                href={`/problems/${activeSession.version.problem.slug}`}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-accent text-white hover:bg-accent/90 transition-colors"
              >
                Continue Session →
              </Link>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Top Metric Cards (Solved Gauge + Badges) ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <SolvedArcCard
          totalProblems={totalProblems}
          solvedTotal={solvedCount}
          attemptingTotal={attemptingCount}
          easy={easyStats}
          med={medStats}
          hard={hardStats}
        />
        <BadgesCard badges={badges} />
      </div>

      {/* ── Yearly Submissions Heatmap ── */}
      <SubmissionHeatmap
        submissions={allSubmissions}
        activeDays={activeDays}
        maxStreak={maxStreak}
      />

      {/* ── Session & Submission History ── */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-text-secondary font-mono">
              Session & Submission History
            </h2>
            <p className="text-xs text-text-secondary mt-0.5">
              Verified scores and marks are recorded exclusively upon actual test submission.
            </p>
          </div>
          <span className="text-xs font-mono text-text-secondary">
            {sessions.length} session{sessions.length === 1 ? "" : "s"}
          </span>
        </div>

        {isLoadingSessions ? (
          <div className="h-24 bg-surface-2 animate-pulse rounded-xl border border-border" />
        ) : sessions.length === 0 ? (
          <div className="rounded-xl border border-border bg-surface p-10 text-center text-text-secondary space-y-2">
            <div className="font-mono text-2xl font-bold text-text-secondary/40">0</div>
            <p className="text-sm font-medium text-text">No test sessions created yet</p>
            <p className="text-xs text-text-secondary max-w-sm mx-auto">
              Pick a ticket from the catalogue to run code in an isolated sandbox and submit your fix.
            </p>
            <div className="pt-2">
              <Link
                href="/problems"
                className="inline-flex items-center text-xs font-mono font-medium text-accent hover:underline"
              >
                Browse catalogue →
              </Link>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-surface overflow-hidden shadow-sm divide-y divide-border">
            {sessions.map((s: Session) => {
              const prob = s.version?.problem;
              const hasSubmissions = s.submissions && s.submissions.length > 0;
              const latestSubmission = hasSubmissions ? s.submissions![0] : null;
              const isSubmitted = s.status === "SUBMITTED" || hasSubmissions;

              return (
                <div
                  key={s.id}
                  className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-surface-2/40 transition-colors"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-text">
                        {prob?.title || `Session #${s.id.slice(-6)}`}
                      </span>
                      {prob && <TrackBadge track={prob.track} />}
                      {prob && <DifficultyBadge difficulty={prob.difficulty} />}
                    </div>

                    <div className="flex items-center gap-3 text-xs font-mono text-text-secondary">
                      <span>Mode: {s.mode}</span>
                      <span>·</span>
                      <span>Started {timeAgo(s.createdAt)}</span>
                      <span>·</span>
                      <span
                        className={cn(
                          "px-1.5 py-0.5 rounded text-[10px] font-semibold",
                          s.status === "ACTIVE"
                            ? "bg-accent-soft text-accent"
                            : s.status === "SUBMITTED"
                            ? "bg-pass-soft text-pass"
                            : "bg-surface-2 text-text-secondary"
                        )}
                      >
                        {s.status}
                      </span>
                    </div>
                  </div>

                  {/* Marks / Action */}
                  <div className="flex items-center gap-4 sm:justify-end">
                    {/* Marks only shown when actually submitted */}
                    <div className="text-right">
                      {isSubmitted && latestSubmission ? (
                        <div>
                          <span
                            className={cn(
                              "font-mono text-sm font-bold",
                              latestSubmission.score === 100 ? "text-pass" : "text-warning"
                            )}
                          >
                            Score: {latestSubmission.score}/100
                          </span>
                          {typeof latestSubmission.confidencePct === "number" && (
                            <div className="text-[10px] font-mono text-text-secondary">
                              {latestSubmission.confidencePct}% confidence
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs font-mono text-text-secondary/60 italic">
                          — (Not submitted)
                        </span>
                      )}
                    </div>

                    {prob?.slug && (
                      <Link
                        href={`/problems/${prob.slug}`}
                        className="px-3 py-1.5 rounded-lg border border-border bg-surface hover:bg-surface-2 text-xs font-mono text-text transition-colors flex-none"
                      >
                        {s.status === "ACTIVE" ? "Resume →" : "View →"}
                      </Link>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ── Recommended Problems ── */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-text-secondary font-mono">
            Available Problems ({problems.length})
          </h2>
          <Link href="/problems" className="text-xs text-accent font-mono hover:underline">
            View full catalogue →
          </Link>
        </div>

        {isLoadingProblems ? (
          <div className="h-16 bg-surface-2 animate-pulse rounded-xl border border-border" />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {problems.map((p: Problem) => (
              <Link
                key={p.id}
                href={`/problems/${p.slug}`}
                className="p-4 rounded-xl border border-border bg-surface hover:border-accent/40 transition-colors flex items-center justify-between gap-3 group"
              >
                <div className="min-w-0 space-y-1">
                  <div className="text-sm font-semibold text-text group-hover:text-accent transition-colors truncate">
                    {p.title}
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <TrackBadge track={p.track} />
                    <DifficultyBadge difficulty={p.difficulty} />
                    <span className="text-xs text-text-secondary font-mono">{p.estMinutes}m</span>
                  </div>
                </div>
                <span className="text-xs font-mono text-accent flex-none group-hover:translate-x-0.5 transition-transform">
                  Start →
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
