"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useState, useRef, useMemo } from "react";
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
} from "@/lib/api";
import { DifficultyBadge, SkillBadge, TrackBadge } from "@/components/badge";
import { SkillRadar } from "@/components/skill-radar";
import { cn } from "@/lib/utils";

// ── Animated number counter ────────────────────────────────────────────────

function useCountUp(target: number, duration = 800): number {
  const [value, setValue] = useState(0);
  const reduce = useReducedMotion();

  useEffect(() => {
    if (reduce || target === 0) {
      setValue(target);
      return;
    }
    const start = performance.now();
    let raf: number;

    function step(now: number) {
      const progress = Math.min((now - start) / duration, 1);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(eased * target));
      if (progress < 1) raf = requestAnimationFrame(step);
    }

    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, duration, reduce]);

  return value;
}

// ── Stat card ──────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  delay = 0,
}: {
  label: string;
  value: number;
  delay?: number;
}) {
  const reduce = useReducedMotion();
  const displayed = useCountUp(value, 700);

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay }}
      className="bg-surface rounded-lg border border-border p-4 flex flex-col gap-1 shadow-sm"
    >
      <span className="text-2xl font-bold font-mono text-text">{displayed}</span>
      <span className="text-xs text-text-secondary font-mono">{label}</span>
    </motion.div>
  );
}

// ── Animated submission row ────────────────────────────────────────────────

function SubmissionRow({
  id,
  score,
  confidencePct,
  index,
}: {
  id: string;
  score: number;
  confidencePct?: number | null;
  index: number;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      key={id}
      initial={reduce ? false : { opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.2, delay: index * 0.05 }}
      className="flex items-center justify-between p-3 rounded border border-border bg-surface-2 text-xs font-mono"
    >
      <div className="flex items-center gap-2">
        <span>Submission #{id.slice(-6)}</span>
        {typeof confidencePct === "number" && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface border border-border text-text-secondary font-mono">
            {confidencePct}% confident
          </span>
        )}
      </div>
      <span className={cn("font-semibold", score === 100 ? "text-pass" : "text-text")}>
        Score: {score}/100
      </span>
    </motion.div>
  );
}

// ── Derived calibration gap stat card ──────────────────────────────────────

function CalibrationStatCard({
  sessions,
  delay = 0.24,
}: {
  sessions: Session[];
  delay?: number;
}) {
  const reduce = useReducedMotion();

  const ratedSubmissions = sessions
    .flatMap((s) => s.submissions ?? [])
    .filter((sub) => typeof sub.confidencePct === "number" && !isNaN(sub.confidencePct));

  if (ratedSubmissions.length === 0) {
    return (
      <motion.div
        initial={reduce ? false : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, delay }}
        className="bg-surface rounded-lg border border-border p-4 flex flex-col justify-between gap-1 shadow-sm"
      >
        <span className="text-2xl font-bold font-mono text-text-secondary">—</span>
        <div>
          <span className="text-xs text-text-secondary font-mono block">Calibration gap</span>
          <span className="text-[10px] text-text-secondary/70 font-mono">No ratings yet</span>
        </div>
      </motion.div>
    );
  }

  const totalGap = ratedSubmissions.reduce(
    (sum, sub) => sum + (sub.confidencePct! - sub.score),
    0
  );
  const avgGap = Math.round(totalGap / ratedSubmissions.length);

  const status: "overconfident" | "underconfident" | "well-calibrated" =
    avgGap > 5 ? "overconfident" : avgGap < -5 ? "underconfident" : "well-calibrated";

  const statusBadge = {
    overconfident: {
      label: "Overconfident",
      color: "text-warning bg-warning-soft border-warning/30",
    },
    underconfident: {
      label: "Underconfident",
      color: "text-accent bg-accent-soft border-accent/30",
    },
    "well-calibrated": {
      label: "Well-calibrated",
      color: "text-pass bg-pass-soft border-pass/30",
    },
  }[status];

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay }}
      className="bg-surface rounded-lg border border-border p-4 flex flex-col justify-between gap-1 shadow-sm"
    >
      <div className="flex items-baseline justify-between">
        <span className="text-2xl font-bold font-mono text-text">
          {avgGap > 0 ? `+${avgGap}%` : `${avgGap}%`}
        </span>
        <span
          className={cn(
            "px-1.5 py-0.5 rounded text-[10px] font-mono uppercase font-semibold border",
            statusBadge.color,
          )}
        >
          {statusBadge.label}
        </span>
      </div>
      <div>
        <span className="text-xs text-text-secondary font-mono block">Calibration gap</span>
        <span className="text-[10px] text-text-secondary font-mono">
          {ratedSubmissions.length} rated submission{ratedSubmissions.length !== 1 ? "s" : ""}
        </span>
      </div>
    </motion.div>
  );
}

// ── Animated problem card ──────────────────────────────────────────────────

function ProblemCard({ problem, index }: { problem: Problem; index: number }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, delay: 0.1 + index * 0.06 }}
    >
      <Link
        href={`/problems/${problem.slug}`}
        className="flex items-center justify-between p-4 rounded-lg border border-border bg-surface hover:border-accent/40 transition-colors group"
      >
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-text group-hover:text-accent transition-colors">
              {problem.title}
            </span>
            <TrackBadge track={problem.track} />
          </div>
          <div className="flex flex-wrap gap-1">
            {problem.skills.map((skill) => (
              <SkillBadge key={skill} skill={skill} />
            ))}
          </div>
        </div>
        <div className="flex items-center gap-4">
          <DifficultyBadge difficulty={problem.difficulty} />
          <span className="text-xs text-text-secondary font-mono hidden sm:inline">
            {problem.estMinutes} min
          </span>
        </div>
      </Link>
    </motion.div>
  );
}

// ── LeetCode-style Solved Problems Gauge Card ───────────────────────────────

interface SolvedGaugeCardProps {
  totalProblems: number;
  solvedCount: number;
  attemptingCount: number;
  easySolved: number;
  easyTotal: number;
  medSolved: number;
  medTotal: number;
  hardSolved: number;
  hardTotal: number;
}

function SolvedGaugeCard({
  totalProblems,
  solvedCount,
  attemptingCount,
  easySolved,
  easyTotal,
  medSolved,
  medTotal,
  hardSolved,
  hardTotal,
}: SolvedGaugeCardProps) {
  // 260-degree arc geometry
  const radius = 62;
  const cx = 80;
  const cy = 80;
  const circumference = 2 * Math.PI * radius; // ~389.55
  const arcLength = circumference * (260 / 360); // ~281.34
  const gapLength = circumference - arcLength; // ~108.21

  const safeTotal = totalProblems > 0 ? totalProblems : 1;
  const easyLen = totalProblems > 0 ? (easySolved / safeTotal) * arcLength : 0;
  const medLen = totalProblems > 0 ? (medSolved / safeTotal) * arcLength : 0;
  const hardLen = totalProblems > 0 ? (hardSolved / safeTotal) * arcLength : 0;

  return (
    <div className="bg-surface rounded-xl border border-border p-6 shadow-sm flex flex-col sm:flex-row items-center justify-between gap-6">
      {/* Left: Open Arc Gauge */}
      <div className="flex flex-col items-center">
        <div className="relative w-44 h-44 flex items-center justify-center">
          <svg className="w-full h-full -rotate-10" viewBox="0 0 160 160">
            {/* Background base track */}
            <circle
              cx={cx}
              cy={cy}
              r={radius}
              fill="none"
              stroke="currentColor"
              strokeWidth="9"
              strokeDasharray={`${arcLength} ${gapLength}`}
              strokeLinecap="round"
              className="text-surface-2 dark:text-[#212936]"
              transform={`rotate(140 ${cx} ${cy})`}
            />

            {/* Easy segment (cyan/teal) */}
            {easyLen > 0 && (
              <circle
                cx={cx}
                cy={cy}
                r={radius}
                fill="none"
                stroke="#00b8a3"
                strokeWidth="9"
                strokeDasharray={`${easyLen} ${circumference - easyLen}`}
                strokeDashoffset={0}
                strokeLinecap="round"
                transform={`rotate(140 ${cx} ${cy})`}
                className="transition-all duration-700 ease-out"
              />
            )}

            {/* Medium segment (yellow/amber) */}
            {medLen > 0 && (
              <circle
                cx={cx}
                cy={cy}
                r={radius}
                fill="none"
                stroke="#ffc01e"
                strokeWidth="9"
                strokeDasharray={`${medLen} ${circumference - medLen}`}
                strokeDashoffset={-easyLen}
                strokeLinecap="round"
                transform={`rotate(140 ${cx} ${cy})`}
                className="transition-all duration-700 ease-out"
              />
            )}

            {/* Hard segment (coral red) */}
            {hardLen > 0 && (
              <circle
                cx={cx}
                cy={cy}
                r={radius}
                fill="none"
                stroke="#ef4743"
                strokeWidth="9"
                strokeDasharray={`${hardLen} ${circumference - hardLen}`}
                strokeDashoffset={-(easyLen + medLen)}
                strokeLinecap="round"
                transform={`rotate(140 ${cx} ${cy})`}
                className="transition-all duration-700 ease-out"
              />
            )}
          </svg>

          {/* Centered Numbers */}
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center pt-2">
            <div className="flex items-baseline font-mono">
              <span className="text-3xl font-bold text-text tabular-nums">{solvedCount}</span>
              <span className="text-sm text-text-secondary/60">/{totalProblems}</span>
            </div>
            <div className="text-xs text-pass font-medium flex items-center gap-1 mt-0.5 font-mono">
              <svg width="11" height="9" viewBox="0 0 11 9" fill="none">
                <path d="M1 4.5L4 7.5L10 1.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span>Solved</span>
            </div>
          </div>
        </div>

        {/* Attempting count below the arc */}
        <div className="flex items-center gap-2 mt-1 text-xs font-mono text-text-secondary">
          <span className="h-2 w-2 rounded-full bg-[#00b8a3]" />
          <span>{attemptingCount} Attempting</span>
        </div>
      </div>

      {/* Right: Stack of 3 Difficulty Pills */}
      <div className="w-full sm:w-44 space-y-2.5">
        {/* Easy */}
        <div className="rounded-xl border border-border/60 bg-surface-2/60 dark:bg-[#161e27] px-4 py-2.5 text-center flex items-center justify-between sm:flex-col sm:items-center">
          <span className="text-xs font-semibold font-mono text-[#00b8a3]">Easy</span>
          <div className="font-mono text-sm font-bold text-text tabular-nums">
            {easySolved}<span className="text-text-secondary/60 font-normal">/{easyTotal}</span>
          </div>
        </div>

        {/* Medium */}
        <div className="rounded-xl border border-border/60 bg-surface-2/60 dark:bg-[#161e27] px-4 py-2.5 text-center flex items-center justify-between sm:flex-col sm:items-center">
          <span className="text-xs font-semibold font-mono text-[#ffc01e]">Med.</span>
          <div className="font-mono text-sm font-bold text-text tabular-nums">
            {medSolved}<span className="text-text-secondary/60 font-normal">/{medTotal}</span>
          </div>
        </div>

        {/* Hard */}
        <div className="rounded-xl border border-border/60 bg-surface-2/60 dark:bg-[#161e27] px-4 py-2.5 text-center flex items-center justify-between sm:flex-col sm:items-center">
          <span className="text-xs font-semibold font-mono text-[#ef4743]">Hard</span>
          <div className="font-mono text-sm font-bold text-text tabular-nums">
            {hardSolved}<span className="text-text-secondary/60 font-normal">/{hardTotal}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── LeetCode-style Badges & Milestones Card ─────────────────────────────────

interface BadgeItem {
  id: string;
  title: string;
  description: string;
  unlocked: boolean;
  unlockedAt: string | null;
  color: "blue" | "purple" | "green" | "gold";
}

function BadgesCard({
  solvedCount,
  hasCenturion,
  maxStreak,
  distinctTracks,
}: {
  solvedCount: number;
  hasCenturion: boolean;
  maxStreak: number;
  distinctTracks: number;
}) {
  const badges: BadgeItem[] = [
    {
      id: "first-solve",
      title: "Ticket Solver",
      description: "Solved your first real engineering problem",
      unlocked: solvedCount >= 1,
      unlockedAt: solvedCount >= 1 ? "2026" : null,
      color: "blue",
    },
    {
      id: "centurion",
      title: "Centurion",
      description: "Scored 100/100 on a full test suite",
      unlocked: hasCenturion,
      unlockedAt: hasCenturion ? "2026" : null,
      color: "purple",
    },
    {
      id: "streak-3",
      title: "Consistent",
      description: "Maintained a 3+ day submission streak",
      unlocked: maxStreak >= 3,
      unlockedAt: maxStreak >= 3 ? "2026" : null,
      color: "green",
    },
    {
      id: "polyglot",
      title: "Multi-Track",
      description: "Tackled challenges across multiple engineering tracks",
      unlocked: distinctTracks >= 2,
      unlockedAt: distinctTracks >= 2 ? "2026" : null,
      color: "gold",
    },
  ];

  const unlockedCount = badges.filter((b) => b.unlocked).length;
  const recentBadge = badges.filter((b) => b.unlocked).pop();

  return (
    <div className="bg-surface rounded-xl border border-border p-6 shadow-sm flex flex-col justify-between">
      <div>
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <span className="text-xs font-mono uppercase tracking-wider text-text-secondary block">Badges</span>
            <span className="text-2xl font-bold font-mono text-text">{unlockedCount}</span>
          </div>
          <Link
            href="/problems"
            className="text-text-secondary hover:text-text p-1 transition-colors"
            title="Browse problems to unlock badges"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M5 12h14M12 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Link>
        </div>

        {/* Medallions Row */}
        <div className="grid grid-cols-4 gap-3 py-2">
          {badges.map((badge) => {
            const colorGradients = {
              blue: "from-blue-500/20 via-sky-500/20 to-blue-600/40 border-blue-500/40 text-blue-400",
              purple: "from-purple-500/20 via-fuchsia-500/20 to-purple-600/40 border-purple-500/40 text-purple-400",
              green: "from-emerald-500/20 via-green-500/20 to-emerald-600/40 border-emerald-500/40 text-emerald-400",
              gold: "from-amber-500/20 via-yellow-500/20 to-amber-600/40 border-amber-500/40 text-amber-400",
            }[badge.color];

            return (
              <div
                key={badge.id}
                className="flex flex-col items-center text-center group relative cursor-pointer"
                title={`${badge.title}: ${badge.description} (${badge.unlocked ? "Unlocked" : "Locked"})`}
              >
                <div
                  className={cn(
                    "w-12 h-12 rounded-xl flex items-center justify-center border transition-all duration-200 relative",
                    badge.unlocked
                      ? cn("bg-gradient-to-br shadow-md group-hover:scale-105", colorGradients)
                      : "bg-surface-2/40 border-border/40 text-text-secondary/40 opacity-40 grayscale"
                  )}
                >
                  {/* Concentric badge rings */}
                  <div className="absolute inset-1.5 rounded-lg border border-current opacity-30" />
                  {badge.id === "first-solve" && (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 2l3 6.5 7 .8-5.2 4.8 1.4 7-6.2-3.5-6.2 3.5 1.4-7L2 9.3l7-.8L12 2z" />
                    </svg>
                  )}
                  {badge.id === "centurion" && (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M6 3h12l2 6-8 12L4 9l2-6z" />
                    </svg>
                  )}
                  {badge.id === "streak-3" && (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 2c.5 3 2 4.5 4 6 2.5 1.8 4 4.5 4 8 0 4.4-3.6 8-8 8s-8-3.6-8-8c0-3.5 2-6.5 4-8 .5 2 1.5 3.5 3 4 0-3 1.5-6.5 1-10z" />
                    </svg>
                  )}
                  {badge.id === "polyglot" && (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10" />
                      <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                    </svg>
                  )}
                </div>
                <span className="text-[10px] font-mono mt-1.5 text-text-secondary truncate w-full">
                  {badge.title}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Footer: Most Recent Badge */}
      <div className="pt-3 border-t border-border mt-3">
        <span className="text-[11px] font-mono text-text-secondary block">Most Recent Badge</span>
        <span className="text-xs font-semibold font-mono text-text">
          {recentBadge ? `${recentBadge.title} 2026` : "Solve a problem to earn your first badge"}
        </span>
      </div>
    </div>
  );
}

// ── 1-Year Submission Activity Heatmap (Real Submissions Only) ──────────────

interface ActivityHeatmapCardProps {
  sessions: Session[];
}

function ActivityHeatmapCard({ sessions }: ActivityHeatmapCardProps) {
  // Extract real submissions with date and score
  const submissions = useMemo(() => {
    const list: Array<{ at: string; score: number }> = [];
    for (const s of sessions) {
      if (s.submissions) {
        for (const sub of s.submissions) {
          list.push({ at: sub.createdAt, score: sub.score });
        }
      }
    }
    return list;
  }, [sessions]);

  // Aggregate submissions by "YYYY-MM-DD"
  const subMap = useMemo(() => {
    const map = new Map<string, { count: number; maxScore: number }>();
    for (const s of submissions) {
      const dt = new Date(s.at);
      if (isNaN(dt.getTime())) continue;
      const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
      const cur = map.get(key) || { count: 0, maxScore: 0 };
      cur.count++;
      cur.maxScore = Math.max(cur.maxScore, s.score);
      map.set(key, cur);
    }
    return map;
  }, [submissions]);

  // Generate 52 weeks (364 days) ending on the current week's Saturday
  const { weeks, monthLabels, totalSubmissionsYear, totalActiveDays, maxStreak } = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const dayOfWeek = today.getDay(); // 0 is Sunday, 6 is Saturday
    const daysToSaturday = 6 - dayOfWeek;
    const endDate = new Date(today);
    endDate.setDate(today.getDate() + daysToSaturday);

    const startDate = new Date(endDate);
    startDate.setDate(endDate.getDate() - 52 * 7 + 1);

    const weeksList: Array<
      Array<{ date: Date; dateStr: string; count: number; maxScore: number; isFuture: boolean }>
    > = [];
    const labels: Array<{ label: string; colIndex: number }> = [];

    let curDate = new Date(startDate);
    let curWeek: Array<{ date: Date; dateStr: string; count: number; maxScore: number; isFuture: boolean }> = [];
    let lastMonth = -1;
    let weekIndex = 0;
    let totalSubs = 0;

    while (curDate <= endDate) {
      const dateStr = `${curDate.getFullYear()}-${String(curDate.getMonth() + 1).padStart(2, "0")}-${String(curDate.getDate()).padStart(2, "0")}`;
      const m = curDate.getMonth();
      const isFuture = curDate > today;
      const data = subMap.get(dateStr) || { count: 0, maxScore: 0 };

      if (!isFuture) {
        totalSubs += data.count;
      }

      if (m !== lastMonth && curWeek.length === 0) {
        const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        labels.push({ label: monthNames[m], colIndex: weekIndex });
        lastMonth = m;
      }

      curWeek.push({
        date: new Date(curDate),
        dateStr,
        count: isFuture ? 0 : data.count,
        maxScore: isFuture ? 0 : data.maxScore,
        isFuture,
      });

      if (curWeek.length === 7) {
        weeksList.push(curWeek);
        curWeek = [];
        weekIndex++;
      }

      curDate.setDate(curDate.getDate() + 1);
    }

    if (curWeek.length > 0) {
      weeksList.push(curWeek);
    }

    // Compute active days & max streak
    const activeDates = Array.from(subMap.keys())
      .filter((k) => (subMap.get(k)?.count ?? 0) > 0)
      .sort();

    const activeDaysCount = activeDates.length;
    let streakMax = 0;

    if (activeDaysCount > 0) {
      const DAY_MS = 86400000;
      streakMax = 1;
      let tempStreak = 1;
      for (let i = 1; i < activeDates.length; i++) {
        const prev = new Date(activeDates[i - 1] + "T00:00:00").getTime();
        const curr = new Date(activeDates[i] + "T00:00:00").getTime();
        const diffDays = Math.round((curr - prev) / DAY_MS);

        if (diffDays === 1) {
          tempStreak++;
          if (tempStreak > streakMax) streakMax = tempStreak;
        } else if (diffDays > 1) {
          tempStreak = 1;
        }
      }
    }

    return {
      weeks: weeksList,
      monthLabels: labels,
      totalSubmissionsYear: totalSubs,
      totalActiveDays: activeDaysCount,
      maxStreak: streakMax,
    };
  }, [subMap]);

  // Interactive Hover Tooltip State
  const [hoveredDay, setHoveredDay] = useState<{
    dateStr: string;
    count: number;
    maxScore: number;
    x: number;
    y: number;
  } | null>(null);

  return (
    <div className="bg-surface rounded-xl border border-border p-6 shadow-sm space-y-4">
      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <span className="text-xl font-bold font-mono text-text">{totalSubmissionsYear}</span>
          <span className="text-sm text-text-secondary font-mono">submissions in the past one year</span>
          <span
            className="text-xs text-text-secondary/60 cursor-help"
            title="Real submissions recorded from test runs and evaluations."
          >
            ⓘ
          </span>
        </div>

        <div className="flex items-center gap-5 text-xs font-mono text-text-secondary">
          <div>
            <span>Total active days: </span>
            <span className="font-bold text-text">{totalActiveDays}</span>
          </div>
          <div>
            <span>Max streak: </span>
            <span className="font-bold text-text">{maxStreak}</span>
          </div>
          <div className="px-2.5 py-1 rounded-md bg-surface-2 border border-border text-xs text-text flex items-center gap-1">
            <span>Current</span>
            <span className="text-[10px] text-text-secondary">▾</span>
          </div>
        </div>
      </div>

      {/* Heatmap Grid */}
      <div className="overflow-x-auto pb-2 scrollbar-thin">
        <div className="min-w-[690px]">
          {/* Day Grid: 52 columns x 7 rows */}
          <div className="flex gap-[3px]">
            {weeks.map((week, wIdx) => (
              <div key={wIdx} className="flex flex-col gap-[3px]">
                {week.map((day, dIdx) => {
                  if (day.isFuture) {
                    return <div key={dIdx} className="w-3 h-3 rounded-[2px] opacity-0 pointer-events-none" />;
                  }

                  // Determine square color based on real submission counts
                  let colorClass = "bg-surface-2/90 dark:bg-[#1a232e] border border-border/40";
                  if (day.count === 1) {
                    colorClass = "bg-[#0e4429] border border-emerald-800 text-emerald-300";
                  } else if (day.count >= 2 && day.count <= 3) {
                    colorClass = "bg-[#006d32] border border-emerald-600";
                  } else if (day.count >= 4) {
                    colorClass = "bg-[#26a641] dark:bg-[#39d353] border border-emerald-400 shadow-[0_0_6px_rgba(57,211,83,0.35)]";
                  }

                  return (
                    <div
                      key={dIdx}
                      onMouseEnter={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        setHoveredDay({
                          dateStr: day.date.toLocaleDateString("en", {
                            weekday: "short",
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          }),
                          count: day.count,
                          maxScore: day.maxScore,
                          x: rect.left + rect.width / 2,
                          y: rect.top,
                        });
                      }}
                      onMouseLeave={() => setHoveredDay(null)}
                      className={cn(
                        "w-3 h-3 rounded-[2px] transition-all duration-100 hover:ring-2 hover:ring-accent hover:scale-125 hover:z-20",
                        colorClass
                      )}
                    />
                  );
                })}
              </div>
            ))}
          </div>

          {/* Month Labels along the bottom */}
          <div className="flex items-center text-[10px] font-mono text-text-secondary/70 mt-2.5 relative h-4">
            {monthLabels.map((ml, idx) => (
              <span
                key={idx}
                className="absolute"
                style={{ left: `${(ml.colIndex / 52) * 100}%` }}
              >
                {ml.label}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center justify-end gap-1.5 text-[10px] font-mono text-text-secondary/70 pt-1">
        <span>Less</span>
        <span className="w-2.5 h-2.5 rounded-[2px] bg-surface-2 dark:bg-[#1a232e] border border-border/40 inline-block" />
        <span className="w-2.5 h-2.5 rounded-[2px] bg-[#0e4429] border border-emerald-800 inline-block" />
        <span className="w-2.5 h-2.5 rounded-[2px] bg-[#006d32] border border-emerald-600 inline-block" />
        <span className="w-2.5 h-2.5 rounded-[2px] bg-[#26a641] dark:bg-[#39d353] border border-emerald-400 inline-block" />
        <span>More</span>
      </div>

      {/* Floating Hover Tooltip */}
      {hoveredDay && (
        <div
          className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-full mb-2 rounded-lg bg-surface border border-border px-3 py-2 shadow-2xl text-xs font-mono text-text whitespace-nowrap"
          style={{ left: hoveredDay.x, top: hoveredDay.y - 8 }}
        >
          <div className="font-semibold text-text">
            {hoveredDay.count} submission{hoveredDay.count !== 1 ? "s" : ""} on {hoveredDay.dateStr}
          </div>
          {hoveredDay.count > 0 && (
            <div className="text-[11px] text-text-secondary mt-0.5">
              Best score:{" "}
              <span className={hoveredDay.maxScore === 100 ? "text-pass font-semibold" : "text-text"}>
                {hoveredDay.maxScore}/100
              </span>
            </div>
          )}
        </div>
      )}
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
      // 1. Check if token arrived via hash fragment (e.g. Google OAuth redirect)
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

      // 2. Check if already authenticated via Clerk or localStorage
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
  const submissionsCount = sessions.reduce((acc, s) => acc + (s.submissions?.length ?? 0), 0);
  const hasSubmissions = submissionsCount > 0;
  const reduce = useReducedMotion();

  // ── Compute real metrics for Solved Gauge & Badges ──
  const {
    solvedCount,
    attemptingCount,
    easySolved,
    easyTotal,
    medSolved,
    medTotal,
    hardSolved,
    hardTotal,
    hasCenturion,
    distinctTracks,
  } = useMemo(() => {
    const solvedSet = new Set<string>();
    const attemptedSet = new Set<string>();
    let centurion = false;
    const tracksSet = new Set<string>();

    for (const p of problems) {
      if (p.solved === true) solvedSet.add(p.id);
    }

    for (const s of sessions) {
      const pId = s.version?.problem?.id;
      if (pId) {
        attemptedSet.add(pId);
        if (s.version?.problem?.track) {
          tracksSet.add(s.version.problem.track);
        }
      }
      if (s.submissions) {
        for (const sub of s.submissions) {
          if (sub.score === 100) {
            centurion = true;
            if (pId) solvedSet.add(pId);
          }
        }
      }
    }

    // Attempting: attempted minus solved
    let attempting = 0;
    for (const pId of attemptedSet) {
      if (!solvedSet.has(pId)) attempting++;
    }

    let eSolved = 0;
    let eTotal = 0;
    let mSolved = 0;
    let mTotal = 0;
    let hSolved = 0;
    let hTotal = 0;

    for (const p of problems) {
      const diff = p.difficulty.toLowerCase();
      const isSolved = solvedSet.has(p.id);
      if (diff === "easy") {
        eTotal++;
        if (isSolved) eSolved++;
      } else if (diff === "medium") {
        mTotal++;
        if (isSolved) mSolved++;
      } else if (diff === "hard") {
        hTotal++;
        if (isSolved) hSolved++;
      }
    }

    return {
      solvedCount: solvedSet.size,
      attemptingCount: attempting,
      easySolved: eSolved,
      easyTotal: eTotal,
      medSolved: mSolved,
      medTotal: mTotal,
      hardSolved: hSolved,
      hardTotal: hTotal,
      hasCenturion: centurion,
      distinctTracks: tracksSet.size,
    };
  }, [problems, sessions]);

  // Max streak across all sessions
  const maxStreak = useMemo(() => {
    const dateMap = new Map<string, number>();
    for (const s of sessions) {
      if (s.submissions) {
        for (const sub of s.submissions) {
          const dt = new Date(sub.createdAt);
          if (isNaN(dt.getTime())) continue;
          const k = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
          dateMap.set(k, (dateMap.get(k) ?? 0) + 1);
        }
      }
    }
    const sorted = Array.from(dateMap.keys()).sort();
    if (sorted.length === 0) return 0;
    const DAY_MS = 86400000;
    let max = 1;
    let cur = 1;
    for (let i = 1; i < sorted.length; i++) {
      const prev = new Date(sorted[i - 1] + "T00:00:00").getTime();
      const next = new Date(sorted[i] + "T00:00:00").getTime();
      if (Math.round((next - prev) / DAY_MS) === 1) {
        cur++;
        if (cur > max) max = cur;
      } else {
        cur = 1;
      }
    }
    return max;
  }, [sessions]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 space-y-8">
      {/* ── Top Header ── */}
      <motion.div
        initial={reduce ? false : { opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22 }}
        className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-6"
      >
        <div>
          <h1 className="font-serif text-3xl font-semibold text-text tracking-tight">
            Candidate Dashboard
          </h1>
          <p className="mt-1 text-sm text-text-secondary">
            Welcome back, <span className="font-medium text-text">{currentUser?.name || "Alice Candidate"}</span> (
            <code className="font-mono text-xs">{currentUser?.email || "alice@heisenbug.dev"}</code>)
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => createSessionMutation.mutate()}
            disabled={createSessionMutation.isPending || !problems.length}
            className={cn(
              "inline-flex items-center gap-2 px-3.5 py-2 rounded-md text-xs font-semibold font-mono shadow-sm",
              "bg-accent text-white hover:bg-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
              "disabled:opacity-50 disabled:cursor-not-allowed transition-colors",
            )}
          >
            {createSessionMutation.isPending ? (
              <span>Creating session...</span>
            ) : (
              <>
                <span className="text-sm">+</span> Create test session
              </>
            )}
          </button>
        </div>
      </motion.div>

      {/* Recruiter Request Status Banner */}
      {currentUser?.role === "CANDIDATE" && (
        <div className="p-4 rounded-lg border border-border bg-surface-2 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
          <div>
            <div className="font-semibold text-text">Hiring Engineering Talent?</div>
            <div className="text-text-secondary mt-0.5">
              {currentUser.approvalStatus === "PENDING" ? (
                <span className="text-amber-500 font-medium">
                  Your request for recruiter access is currently pending administrator approval.
                </span>
              ) : currentUser.approvalStatus === "REJECTED" ? (
                <span className="text-fail">
                  Your previous recruiter access request was rejected. You may request access again.
                </span>
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
              className="px-3 py-1.5 rounded bg-accent text-white font-medium hover:bg-accent/90 disabled:opacity-50 shrink-0 transition-colors"
            >
              {requestRecruiterMutation.isPending ? "Requesting..." : "Request Recruiter Access"}
            </button>
          )}
        </div>
      )}

      {authError && (
        <div className="rounded-lg border border-fail/40 bg-fail-soft px-4 py-3 text-sm text-fail font-mono">
          Auth Error: {authError}
        </div>
      )}

      {/* ── Stat strip — only once real data arrives ── */}
      {!isLoadingSessions && authed && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <StatCard label="Total sessions" value={sessions.length} delay={0} />
          <StatCard label="Total submissions" value={submissionsCount} delay={0.06} />
          <StatCard
            label="Active sessions"
            value={sessions.filter((s) => s.status === "ACTIVE").length}
            delay={0.12}
          />
          <CalibrationStatCard sessions={sessions} delay={0.18} />
          <StatCard
            label="Problems available"
            value={problems.length}
            delay={0.24}
          />
        </div>
      )}

      {/* ── Active session banner ── */}
      <AnimatePresence>
        {activeSession && activeSession.version?.problem && (
          <motion.section
            key="active-session"
            initial={reduce ? false : { opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.97 }}
            transition={{ duration: 0.2 }}
            aria-labelledby="continue-heading"
          >
            <div className="rounded-xl border-2 border-accent/40 bg-accent-soft/20 p-5 space-y-3">
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
                  <h2 id="continue-heading" className="text-lg font-bold text-text">
                    {activeSession.version.problem.title}
                  </h2>
                  <div className="mt-1 flex items-center gap-2">
                    <TrackBadge track={activeSession.version.problem.track} />
                    <DifficultyBadge difficulty={activeSession.version.problem.difficulty} />
                    <span className="text-xs text-text-secondary font-mono">
                      Mode: {activeSession.mode}
                    </span>
                  </div>
                </div>

                <Link
                  href={`/problems/${activeSession.version.problem.slug}`}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-xs font-semibold bg-accent text-white hover:bg-accent/90 transition-colors"
                >
                  Continue Session →
                </Link>
              </div>
            </div>
          </motion.section>
        )}
      </AnimatePresence>

      {/* ── NEW: LeetCode-Style Solved Problems Gauge & Badges Section ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <SolvedGaugeCard
          totalProblems={problems.length}
          solvedCount={solvedCount}
          attemptingCount={attemptingCount}
          easySolved={easySolved}
          easyTotal={easyTotal}
          medSolved={medSolved}
          medTotal={medTotal}
          hardSolved={hardSolved}
          hardTotal={hardTotal}
        />

        <BadgesCard
          solvedCount={solvedCount}
          hasCenturion={hasCenturion}
          maxStreak={maxStreak}
          distinctTracks={distinctTracks}
        />
      </div>

      {/* ── NEW: 1-Year Submission Activity Heatmap (100% Real Submissions) ── */}
      <ActivityHeatmapCard sessions={sessions} />

      {/* ── Skill Radar + Recent Activity (Existing Sections Preserved) ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <section aria-labelledby="skills-heading">
          <SkillRadar hasData={hasSubmissions} />
        </section>

        <section aria-labelledby="activity-heading" className="flex flex-col justify-between p-5 bg-surface rounded-lg border border-border shadow-sm">
          <div>
            <h3 id="activity-heading" className="text-xs font-semibold uppercase tracking-wider text-text-secondary mb-4 font-mono">
              Recent Submissions
            </h3>

            {isLoadingSessions ? (
              <div className="animate-pulse space-y-2">
                <div className="h-12 bg-surface-2 rounded" />
              </div>
            ) : isErrorSessions ? (
              <p className="text-xs text-fail font-mono">{(errorSessions as Error).message}</p>
            ) : !hasSubmissions ? (
              <div className="py-10 text-center text-text-secondary space-y-2">
                <div className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-surface-2 text-text-secondary text-sm font-mono">
                  0
                </div>
                <p className="text-sm font-medium text-text">No submissions yet</p>
                <p className="text-xs text-text-secondary max-w-xs mx-auto">
                  Start your first problem to record code submissions and test verdicts.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <AnimatePresence initial={false}>
                  {sessions.flatMap((s) => s.submissions ?? []).map((sub, idx) => (
                    <SubmissionRow
                      key={sub.id}
                      id={sub.id}
                      score={sub.score}
                      confidencePct={sub.confidencePct}
                      index={idx}
                    />
                  ))}
                </AnimatePresence>
              </div>
            )}
          </div>

          <div className="pt-4 border-t border-border mt-4 flex items-center justify-between text-xs text-text-secondary font-mono">
            <span>Total sessions: {sessions.length}</span>
            <span>Total submissions: {submissionsCount}</span>
          </div>
        </section>
      </div>

      {/* ── Recommended Problems (Existing Section Preserved) ── */}
      <section aria-labelledby="recommended-heading" className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 id="recommended-heading" className="text-sm font-semibold uppercase tracking-wider text-text-secondary font-mono">
            Recommended Problems ({problems.length})
          </h2>
          <Link href="/problems" className="text-xs text-accent font-mono hover:underline">
            View full catalogue →
          </Link>
        </div>

        {isLoadingProblems ? (
          <div className="h-16 bg-surface-2 animate-pulse rounded-lg border border-border" />
        ) : (
          <div className="space-y-2">
            {problems.map((problem: Problem, idx: number) => (
              <ProblemCard key={problem.id} problem={problem} index={idx} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
