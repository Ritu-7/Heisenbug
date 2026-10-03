"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import Link from "next/link";
import {
  fetchAssessment,
  createInvitation,
  type Invitation,
  type InvitationStatus,
} from "@/lib/api";
import { cn } from "@/lib/utils";

// ── Schemas ────────────────────────────────────────────────────────────────

const InviteFormSchema = z.object({
  candidateEmail: z.string().email("Enter a valid email address"),
});
type InviteFormValues = z.infer<typeof InviteFormSchema>;

// ── Status badge ──────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: InvitationStatus }) {
  const map: Record<InvitationStatus, { label: string; className: string }> = {
    INVITED: {
      label: "Invited",
      className: "bg-surface-2 text-text-secondary border-border",
    },
    STARTED: {
      label: "Started",
      className: "bg-warning-soft text-warning border-warning/30",
    },
    SUBMITTED: {
      label: "Submitted",
      className: "bg-pass-soft text-pass border-pass/30",
    },
    EXPIRED: {
      label: "Expired",
      className: "bg-fail-soft text-fail border-fail/30",
    },
  };
  const { label, className } = map[status];
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold font-mono border",
        className,
      )}
    >
      {label}
    </span>
  );
}

// ── Invitation row ────────────────────────────────────────────────────────

function InvitationRow({ invitation }: { invitation: Invitation }) {
  return (
    <div className="flex items-center justify-between px-4 py-3 rounded-lg border border-border bg-surface-2 text-sm">
      <div className="min-w-0">
        <p className="font-medium text-text truncate">{invitation.candidateEmail}</p>
        <p className="text-xs text-text-secondary font-mono mt-0.5">
          Expires {new Date(invitation.expiresAt).toLocaleDateString()}
        </p>
      </div>
      <StatusBadge status={invitation.status} />
    </div>
  );
}

// ── Invite form ──────────────────────────────────────────────────────────

function InviteForm({ assessmentId }: { assessmentId: string }) {
  const queryClient = useQueryClient();
  const [lastLink, setLastLink] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<InviteFormValues>({ resolver: zodResolver(InviteFormSchema) });

  const mutation = useMutation({
    mutationFn: ({ candidateEmail }: InviteFormValues) =>
      createInvitation(assessmentId, candidateEmail),
    onSuccess: (data) => {
      setLastLink(data.inviteUrl);
      reset();
      queryClient.invalidateQueries({ queryKey: ["assessment", assessmentId] });
    },
  });

  return (
    <div className="space-y-3">
      <form
        onSubmit={handleSubmit((v) => mutation.mutate(v))}
        className="flex items-start gap-2"
      >
        <div className="flex-1 space-y-1">
          <input
            {...register("candidateEmail")}
            type="email"
            placeholder="candidate@example.com"
            className={cn(
              "w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text",
              "placeholder:text-text-secondary/50 focus:outline-none focus:ring-1 focus:ring-accent focus:border-accent",
            )}
          />
          {errors.candidateEmail && (
            <p className="text-xs text-fail font-mono">{errors.candidateEmail.message}</p>
          )}
        </div>
        <button
          type="submit"
          disabled={mutation.isPending}
          className="px-4 py-2 rounded-md text-xs font-semibold bg-accent text-white hover:bg-accent/90 disabled:opacity-50 transition-colors whitespace-nowrap"
        >
          {mutation.isPending ? "Sending..." : "Invite →"}
        </button>
      </form>

      {mutation.isError && (
        <p className="text-xs text-fail font-mono">
          Error: {(mutation.error as Error).message}
        </p>
      )}

      {/* Real invite link — returned directly from the API */}
      {lastLink && (
        <div className="rounded-md border border-pass/30 bg-pass-soft p-3 space-y-1">
          <p className="text-xs font-semibold text-pass">Invitation created — share this link:</p>
          <p className="text-xs font-mono text-text break-all">{lastLink}</p>
          <button
            onClick={() => navigator.clipboard.writeText(lastLink)}
            className="text-[10px] font-mono text-accent hover:underline mt-1"
          >
            Copy to clipboard
          </button>
        </div>
      )}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function AssessmentDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const { data: assessment, isLoading, isError, error } = useQuery({
    queryKey: ["assessment", params.id],
    queryFn: () => fetchAssessment(params.id),
    refetchInterval: 15_000, // re-fetch every 15 s so status updates appear without manual refresh
  });

  if (isLoading) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-10">
        <div className="animate-pulse space-y-3">
          <div className="h-8 w-1/3 bg-surface-2 rounded" />
          <div className="h-4 w-1/4 bg-surface-2 rounded" />
        </div>
      </div>
    );
  }

  if (isError || !assessment) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-10 space-y-3">
        <p className="text-sm text-fail">{(error as Error)?.message ?? "Assessment not found"}</p>
        <Link href="/recruiter/dashboard" className="text-xs text-accent hover:underline font-mono">
          ← Back to dashboard
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 space-y-8">
      {/* Header */}
      <div className="space-y-1">
        <Link
          href="/recruiter/dashboard"
          className="text-xs text-text-secondary hover:text-text font-mono transition-colors"
        >
          ← dashboard
        </Link>
        <h1 className="font-serif text-2xl font-semibold text-text">{assessment.title}</h1>
        <p className="text-sm text-text-secondary font-mono">
          {assessment.timeLimitMinutes} min · {assessment.problems.length} problem
          {assessment.problems.length !== 1 ? "s" : ""} ·{" "}
          {assessment.invitations.length} invitation
          {assessment.invitations.length !== 1 ? "s" : ""}
        </p>
      </div>

      {/* Problems */}
      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-text-secondary font-mono">
          Problems
        </h2>
        <div className="space-y-2">
          {assessment.problems.map((ap, i) => (
            <div
              key={ap.id}
              className="flex items-center gap-3 px-4 py-3 rounded-lg border border-border bg-surface"
            >
              <span className="text-xs font-mono text-text-secondary w-4 shrink-0">{i + 1}.</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-text truncate">
                  {ap.version.problem.title}
                </p>
                <p className="text-xs text-text-secondary font-mono">{ap.version.problem.slug}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Invite candidate */}
      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-text-secondary font-mono">
          Invite Candidate
        </h2>
        <InviteForm assessmentId={assessment.id} />
      </section>

      {/* Invitation list with real derived status */}
      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-text-secondary font-mono">
          Invitations ({assessment.invitations.length})
        </h2>

        {assessment.invitations.length === 0 ? (
          <div className="py-10 text-center text-text-secondary">
            <p className="text-sm">No invitations sent yet.</p>
            <p className="text-xs mt-1">Use the form above to invite a candidate.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {assessment.invitations.map((inv) => (
              <InvitationRow key={inv.id} invitation={inv} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
