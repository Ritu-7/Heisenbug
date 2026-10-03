"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import Link from "next/link";
import {
  loginUser,
  getAuthToken,
  setAuthToken,
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

// ── Sub-components ─────────────────────────────────────────────────────────

function AssessmentRow({ assessment }: { assessment: Assessment }) {
  return (
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
    <div className="rounded-xl border border-border bg-surface p-6 space-y-5">
      <h2 className="text-sm font-semibold text-text">New Assessment</h2>
      <form
        onSubmit={handleSubmit((v) => mutation.mutate(v))}
        className="space-y-4"
      >
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

        {/* Problem single-select */}
        <div className="space-y-1">
          <label className="text-xs font-medium text-text-secondary">
            Target Problem
          </label>
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
          <button
            type="submit"
            disabled={isSubmitting || mutation.isPending}
            className="px-4 py-2 rounded-md text-xs font-semibold bg-accent text-white hover:bg-accent/90 disabled:opacity-50 transition-colors"
          >
            {mutation.isPending ? "Creating..." : "Create Assessment"}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded-md text-xs font-medium text-text-secondary hover:text-text border border-border hover:border-accent/40 transition-colors"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function RecruiterDashboard() {
  const queryClient = useQueryClient();
  const [authed, setAuthed] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  // Auto-login as recruiter for this page
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
  });

  const { data: problems = [], isLoading: problemsLoading } = useQuery({
    queryKey: ["problems"],
    queryFn: fetchProblems,
    enabled: authed,
  });

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-serif text-3xl font-semibold text-text tracking-tight">
            Recruiter Dashboard
          </h1>
          <p className="mt-1 text-sm text-text-secondary">
            Create assessments, invite candidates, review results.
          </p>
        </div>
        {!showForm && authed && (
          <button
            onClick={() => setShowForm(true)}
            className="px-4 py-2 rounded-md text-xs font-semibold bg-accent text-white hover:bg-accent/90 transition-colors"
          >
            + New Assessment
          </button>
        )}
      </div>

      {authError && (
        <div className="rounded-lg border border-fail/40 bg-fail-soft px-4 py-3 text-sm text-fail font-mono">
          Auth error: {authError}
        </div>
      )}

      {/* New Assessment Form */}
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
          <div className="py-16 text-center text-text-secondary space-y-2">
            <p className="text-sm font-medium text-text">No assessments yet</p>
            <p className="text-xs">
              Click &quot;+ New Assessment&quot; above to create your first one.
            </p>
          </div>
        )}

        {!isLoading && !isError && (
          <div className="space-y-2">
            {assessments.map((a) => (
              <AssessmentRow key={a.id} assessment={a} />
            ))}
          </div>
        )}
      </section>

      {/* Problems loading state (used by form) */}
      {problemsLoading && showForm && (
        <p className="text-xs text-text-secondary font-mono">Loading problems...</p>
      )}
    </div>
  );
}
