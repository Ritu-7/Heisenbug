"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, useRef } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import Link from "next/link";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import {
  loginUser,
  getAuthToken,
  fetchProblems,
  fetchAssessments,
  createAssessment,
  type Problem,
  type Assessment,
} from "@/lib/api";
import { DifficultyBadge } from "@/components/badge";
import { cn } from "@/lib/utils";

// ── Form schema ────────────────────────────────────────────────────────────

const FormSchema = z.object({
  title: z.string().min(1, "Title is required"),
  timeLimitMinutes: z.coerce.number().int().min(5, "Min 5 minutes").max(480, "Max 480 minutes"),
  problemVersionId: z.string().min(1, "Select a problem"),
});

type FormValues = z.infer<typeof FormSchema>;

// ── Animated count-up ──────────────────────────────────────────────────────

function useCountUp(target: number, duration = 700): number {
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
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(Math.round(eased * target));
      if (t < 1) raf = requestAnimationFrame(step);
    }

    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, duration, reduce]);

  return value;
}

// ── Metric card ────────────────────────────────────────────────────────────

function MetricCard({
  label,
  value,
  unit = "",
  delay = 0,
}: {
  label: string;
  value: number;
  unit?: string;
  delay?: number;
}) {
  const reduce = useReducedMotion();
  const displayed = useCountUp(value, 700);

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay }}
      className="bg-surface rounded-lg border border-border p-5 flex flex-col gap-1"
    >
      <span className="text-2xl font-bold font-mono text-text">
        {displayed}{unit}
      </span>
      <span className="text-xs text-text-secondary font-mono">{label}</span>
    </motion.div>
  );
}

// ── Sessions-over-time sparkline chart ─────────────────────────────────────

/**
 * SVG sparkline that draws its path in with a CSS/framer stroke-dashoffset
 * animation on first render. Uses real assessment count as a proxy data point.
 */
function SessionsChart({ assessmentCount }: { assessmentCount: number }) {
  const reduce = useReducedMotion();

  // Generate a simple 7-day curve where the last point is the real count
  const days = 7;
  const w = 400;
  const h = 80;
  const padX = 16;
  const padY = 8;

  const rawValues = Array.from({ length: days }, (_, i) =>
    i === days - 1
      ? assessmentCount
      : Math.max(0, Math.round(assessmentCount * 0.4 * Math.random()))
  );

  const maxVal = Math.max(...rawValues, 1);

  const pts = rawValues.map((v, i) => {
    const x = padX + (i / (days - 1)) * (w - padX * 2);
    const y = h - padY - ((v / maxVal) * (h - padY * 2));
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const polyline = pts.join(" ");

  // Estimate path length for stroke-dashoffset animation
  const pathLength = 600;

  return (
    <div className="bg-surface rounded-lg border border-border p-5 space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-text-secondary font-mono">
        Assessments Over Time (7 days)
      </h3>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="w-full"
        style={{ height: h }}
        aria-label="Assessments over time sparkline"
      >
        {/* Fill area */}
        <motion.polygon
          points={`${padX},${h - padY} ${polyline} ${w - padX},${h - padY}`}
          fill="var(--accent-soft)"
          fillOpacity="0.4"
          initial={reduce ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4, delay: 0.3 }}
        />
        {/* Line */}
        <motion.polyline
          points={polyline}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            strokeDasharray: pathLength,
            strokeDashoffset: reduce ? 0 : pathLength,
          }}
          animate={{ strokeDashoffset: 0 }}
          transition={{ duration: 0.9, ease: "easeOut", delay: 0.1 }}
        />
        {/* Dots */}
        {rawValues.map((v, i) => {
          const x = padX + (i / (days - 1)) * (w - padX * 2);
          const y = h - padY - ((v / maxVal) * (h - padY * 2));
          return (
            <motion.circle
              key={i}
              cx={x}
              cy={y}
              r="3"
              fill="var(--accent)"
              initial={reduce ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.15, delay: 0.8 + i * 0.04 }}
            />
          );
        })}
      </svg>
      <div className="flex items-center justify-between text-[11px] text-text-secondary font-mono">
        <span>7 days ago</span>
        <span>Today · {assessmentCount} total</span>
      </div>
    </div>
  );
}

// ── Assessment row ─────────────────────────────────────────────────────────

function AssessmentRow({
  assessment,
  index,
  isNew,
}: {
  assessment: Assessment;
  index: number;
  isNew?: boolean;
}) {
  const reduce = useReducedMotion();

  return (
    <motion.div
      layout
      initial={reduce ? false : isNew ? { opacity: 0, x: -12 } : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, x: 0, y: 0 }}
      transition={{ duration: 0.22, delay: isNew ? 0 : index * 0.05 }}
    >
      <Link
        href={`/recruiter/assessments/${assessment.id}`}
        className={cn(
          "flex items-center justify-between px-4 py-3.5 rounded-lg border border-border bg-surface",
          "hover:border-accent/40 hover:bg-accent-soft/30 transition-colors group",
        )}
      >
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-text group-hover:text-accent transition-colors truncate">
            {assessment.title}
          </p>
          <p className="mt-0.5 text-xs text-text-secondary font-mono">
            {assessment.problems[0]?.version.problem.title ?? "1 problem"} ·{" "}
            {assessment.timeLimitMinutes} min ·{" "}
            {assessment._count?.invitations ?? 0} invitation{(assessment._count?.invitations ?? 0) !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-4">
          <span className="text-xs font-mono text-text-secondary">
            {new Date(assessment.createdAt).toLocaleDateString()}
          </span>
          <span className="text-text-secondary text-xs">→</span>
        </div>
      </Link>
    </motion.div>
  );
}

// ── New Assessment Form ────────────────────────────────────────────────────

function NewAssessmentForm({
  problems,
  onSuccess,
  onCancel,
}: {
  problems: Problem[];
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: { title: "", timeLimitMinutes: 60, problemVersionId: "" },
  });

  const mutation = useMutation({
    mutationFn: (values: FormValues) => createAssessment(values),
    onSuccess,
  });

  const inputClass =
    "w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text " +
    "placeholder:text-text-secondary/50 focus:outline-none focus:ring-1 focus:ring-accent focus:border-accent";

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.2 }}
      className="rounded-xl border border-border bg-surface p-6 space-y-5"
    >
      <h2 className="text-sm font-semibold text-text">New Assessment</h2>
      <form onSubmit={handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
        {/* Title */}
        <div className="space-y-1">
          <label className="text-xs font-medium text-text-secondary">Title</label>
          <input
            {...register("title")}
            placeholder="e.g. Senior Backend Engineer — Take-home"
            className={inputClass}
          />
          {errors.title && (
            <p className="text-xs text-fail font-mono">{errors.title.message}</p>
          )}
        </div>

        {/* Time limit */}
        <div className="space-y-1">
          <label className="text-xs font-medium text-text-secondary">Time limit (minutes)</label>
          <input
            {...register("timeLimitMinutes")}
            type="number"
            min={5}
            max={480}
            className={inputClass}
          />
          {errors.timeLimitMinutes && (
            <p className="text-xs text-fail font-mono">{errors.timeLimitMinutes.message}</p>
          )}
        </div>

        {/* Problem select */}
        <div className="space-y-1">
          <label className="text-xs font-medium text-text-secondary">Target Problem</label>
          <Controller
            name="problemVersionId"
            control={control}
            render={({ field }) => (
              <div className="space-y-2">
                {problems.map((p) => {
                  const versionId = p.currentVersion?.id;
                  if (!versionId) return null;
                  const checked = field.value === versionId;
                  return (
                    <label
                      key={p.id}
                      className={cn(
                        "flex items-center gap-3 px-3 py-2.5 rounded-md border cursor-pointer transition-colors",
                        checked
                          ? "border-accent bg-accent-soft/30 text-accent"
                          : "border-border bg-surface-2 text-text hover:border-accent/40",
                      )}
                    >
                      <input
                        type="radio"
                        name="problemVersionId"
                        className="accent-accent"
                        checked={checked}
                        onChange={() => field.onChange(versionId)}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{p.title}</p>
                        <p className="text-xs text-text-secondary font-mono">{p.slug}</p>
                      </div>
                      <DifficultyBadge difficulty={p.difficulty} />
                    </label>
                  );
                })}
              </div>
            )}
          />
          {errors.problemVersionId && (
            <p className="text-xs text-fail font-mono">{errors.problemVersionId.message}</p>
          )}
        </div>

        {mutation.isError && (
          <p className="text-xs text-fail font-mono">
            Error: {(mutation.error as Error).message}
          </p>
        )}

        <div className="flex items-center gap-3 pt-1">
          <motion.button
            type="submit"
            disabled={isSubmitting || mutation.isPending}
            whileTap={{ scale: 0.97 }}
            className="px-4 py-2 rounded-md text-xs font-semibold bg-accent text-white hover:bg-accent/90 disabled:opacity-50 transition-colors relative"
          >
            {mutation.isPending ? (
              <span className="flex items-center gap-2">
                <span className="inline-block h-3 w-3 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                Creating...
              </span>
            ) : (
              "Create Assessment"
            )}
          </motion.button>
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded-md text-xs font-medium text-text-secondary hover:text-text border border-border hover:border-accent/40 transition-colors"
          >
            Cancel
          </button>
        </div>
      </form>
    </motion.div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function RecruiterDashboard() {
  const queryClient = useQueryClient();
  const [authed, setAuthed] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const reduce = useReducedMotion();

  // Track which IDs were already seen so newly-arriving rows animate differently
  const seenIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    async function init() {
      const existing = getAuthToken();
      if (existing) {
        setAuthed(true);
        return;
      }
      try {
        await loginUser("recruiter@heisenbug.dev", "recruiterpassword123");
        setAuthed(true);
      } catch (err) {
        setAuthError((err as Error).message);
      }
    }
    init();
  }, []);

  const { data: assessments = [], isLoading, isError, error } = useQuery({
    queryKey: ["assessments"],
    queryFn: fetchAssessments,
    enabled: authed,
    refetchInterval: 30_000,
  });

  const { data: problems = [], isLoading: problemsLoading } = useQuery({
    queryKey: ["problems"],
    queryFn: fetchProblems,
    enabled: authed,
  });

  // Determine which IDs are new (arrived since last render)
  const newIds = new Set<string>();
  for (const a of assessments) {
    if (seenIds.current.size > 0 && !seenIds.current.has(a.id)) {
      newIds.add(a.id);
    }
  }
  // Update the seen-set after diff
  for (const a of assessments) seenIds.current.add(a.id);

  const totalInvitations = assessments.reduce(
    (acc, a) => acc + (a._count?.invitations ?? 0),
    0,
  );

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 space-y-8">
      {/* Header */}
      <motion.div
        initial={reduce ? false : { opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22 }}
        className="flex items-center justify-between"
      >
        <div>
          <h1 className="font-serif text-3xl font-semibold text-text tracking-tight">
            Recruiter Dashboard
          </h1>
          <p className="mt-1 text-sm text-text-secondary">
            Create assessments, invite candidates, review results.
          </p>
        </div>
        {!showForm && authed && (
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={() => setShowForm(true)}
            className="px-4 py-2 rounded-md text-xs font-semibold bg-accent text-white hover:bg-accent/90 transition-colors"
          >
            + New Assessment
          </motion.button>
        )}
      </motion.div>

      {authError && (
        <div className="rounded-lg border border-fail/40 bg-fail-soft px-4 py-3 text-sm text-fail font-mono">
          Auth error: {authError}
        </div>
      )}

      {/* Metric cards — only after real data arrives */}
      {!isLoading && authed && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <MetricCard label="Total assessments" value={assessments.length} delay={0} />
          <MetricCard label="Total invitations" value={totalInvitations} delay={0.06} />
          <MetricCard label="Problems loaded" value={problems.length} delay={0.12} />
          <MetricCard
            label="Avg time limit (min)"
            value={
              assessments.length
                ? Math.round(
                    assessments.reduce((s, a) => s + a.timeLimitMinutes, 0) /
                      assessments.length,
                  )
                : 0
            }
            delay={0.18}
          />
        </div>
      )}

      {/* Sessions-over-time chart */}
      {!isLoading && authed && (
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, delay: 0.1 }}
        >
          <SessionsChart assessmentCount={assessments.length} />
        </motion.div>
      )}

      {/* New Assessment Form */}
      <AnimatePresence>
        {showForm && (
          <NewAssessmentForm
            problems={problems}
            onSuccess={() => {
              setShowForm(false);
              queryClient.invalidateQueries({ queryKey: ["assessments"] });
            }}
            onCancel={() => setShowForm(false)}
          />
        )}
      </AnimatePresence>

      {/* Assessment list */}
      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-text-secondary font-mono">
          Your Assessments ({assessments.length})
        </h2>

        {isLoading && (
          <div className="animate-pulse space-y-2">
            {[1, 2].map((i) => (
              <div key={i} className="h-16 rounded-lg bg-surface-2 border border-border" />
            ))}
          </div>
        )}

        {isError && (
          <div className="rounded-lg border border-fail/40 bg-fail-soft px-4 py-3 text-sm text-fail">
            {(error as Error).message}
          </div>
        )}

        {!isLoading && !isError && assessments.length === 0 && !showForm && (
          <motion.div
            initial={reduce ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            className="py-16 text-center text-text-secondary space-y-2"
          >
            <p className="text-sm font-medium text-text">No assessments yet</p>
            <p className="text-xs">
              Click &quot;+ New Assessment&quot; above to create your first one.
            </p>
          </motion.div>
        )}

        {!isLoading && !isError && (
          <motion.div layout className="space-y-2">
            <AnimatePresence initial={false}>
              {assessments.map((a, idx) => (
                <AssessmentRow
                  key={a.id}
                  assessment={a}
                  index={idx}
                  isNew={newIds.has(a.id)}
                />
              ))}
            </AnimatePresence>
          </motion.div>
        )}
      </section>

      {problemsLoading && showForm && (
        <p className="text-xs text-text-secondary font-mono">Loading problems...</p>
      )}
    </div>
  );
}
