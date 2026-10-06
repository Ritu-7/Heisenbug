"use client";

import { useQuery, useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import {
  fetchInvitation,
  startInvitation,
  setAuthToken,
} from "@/lib/api";
import { cn } from "@/lib/utils";

export default function InvitePage({ params }: { params: { token: string } }) {
  const router = useRouter();
  const { token } = params;
  const reduce = useReducedMotion();

  // Fetch invitation summary — real 410/409/404 responses from the API
  const {
    data: invitation,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ["invitation", token],
    queryFn: () => fetchInvitation(token),
    retry: false, // don't retry on 410/409 — those are real terminal states
  });

  // Start assessment: creates session, gets back JWT + session data
  const startMutation = useMutation({
    mutationFn: () => startInvitation(token),
    onSuccess: (data) => {
      setAuthToken(data.token);
      const slug = data.session.version?.problem?.slug;
      if (slug) {
        router.push(`/problems/${slug}?sessionId=${data.session.id}`);
      }
    },
  });

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <span className="text-sm text-text-secondary font-mono animate-pulse">
          Checking invitation...
        </span>
      </div>
    );
  }

  // Real error states — distinguish by HTTP status
  if (isError || !invitation) {
    const err = error as (Error & { status?: number }) | null;
    const status = err?.status;

    let title = "Invalid invitation";
    let message = "This invitation link is not valid.";
    let icon = "✗";

    if (status === 410) {
      title = "Invitation expired";
      message = "This invitation link has expired. Please contact the recruiter for a new one.";
      icon = "⏱";
    } else if (status === 409) {
      title = "Already started";
      message = "This invitation has already been used to start an assessment session.";
      icon = "✓";
    } else if (err?.message) {
      message = err.message;
    }

    return (
      <div className="flex min-h-[60vh] items-center justify-center px-4">
        <motion.div
          initial={reduce ? false : { opacity: 0, scale: 0.95, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.25, ease: "easeOut" }}
          className="max-w-md w-full rounded-xl border border-border bg-surface p-8 text-center space-y-4"
        >
          <div
            className={cn(
              "inline-flex h-12 w-12 items-center justify-center rounded-full text-2xl mx-auto font-mono",
              status === 409 ? "bg-pass-soft text-pass" : "bg-fail-soft text-fail",
            )}
          >
            {icon}
          </div>
          <h1 className="font-serif text-xl font-semibold text-text">{title}</h1>
          <p className="text-sm text-text-secondary">{message}</p>
        </motion.div>
      </div>
    );
  }

  // Valid invitation — show assessment summary and Start button
  const expiresDate = new Date(invitation.expiresAt);

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4 py-10">
      <motion.div
        initial={reduce ? false : { opacity: 0, scale: 0.96, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.28, ease: "easeOut" }}
        className="max-w-md w-full rounded-xl border border-border bg-surface p-8 space-y-6"
      >
        {/* Header */}
        <div className="text-center space-y-1">
          <p className="text-xs font-mono text-text-secondary">You&apos;ve been invited to take</p>
          <h1 className="font-serif text-2xl font-semibold text-text">
            {invitation.assessment.title}
          </h1>
        </div>

        {/* Assessment details */}
        <div className="rounded-lg border border-border bg-surface-2 divide-y divide-border">
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-xs text-text-secondary font-mono">Time limit</span>
            <span className="text-sm font-semibold text-text font-mono">
              {invitation.assessment.timeLimitMinutes} minutes
            </span>
          </div>
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-xs text-text-secondary font-mono">Problems</span>
            <span className="text-sm font-semibold text-text font-mono">
              {invitation.assessment.problemCount}
            </span>
          </div>
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-xs text-text-secondary font-mono">Candidate</span>
            <span className="text-sm text-text font-mono">{invitation.candidateEmail}</span>
          </div>
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-xs text-text-secondary font-mono">Link expires</span>
            <span className="text-sm text-text font-mono">
              {expiresDate.toLocaleDateString()} {expiresDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
          </div>
        </div>

        {/* Notes */}
        <div className="text-xs text-text-secondary space-y-1.5">
          <p>• Once you click &quot;Start Assessment&quot;, the timer begins immediately.</p>
          <p>• Hints, Editorial, and Reference Solution are locked in assessment mode.</p>
          <p>• You may run visible tests as many times as you like before submitting.</p>
          <p>• Your final submission triggers grading against the full (hidden) test suite.</p>
        </div>

        <AnimatePresence>
          {startMutation.isError && (
            <motion.p
              initial={reduce ? false : { opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="text-xs text-fail font-mono"
            >
              Error: {(startMutation.error as Error).message}
            </motion.p>
          )}
        </AnimatePresence>

        {/* Start button */}
        <button
          onClick={() => startMutation.mutate()}
          disabled={startMutation.isPending}
          className={cn(
            "w-full py-3 rounded-md text-sm font-semibold transition-colors font-mono",
            "bg-accent text-white hover:bg-accent/90",
            "disabled:opacity-50 disabled:cursor-not-allowed",
          )}
        >
          {startMutation.isPending ? (
            <span className="inline-flex items-center justify-center gap-2">
              <span className="inline-block h-3.5 w-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
              Starting...
            </span>
          ) : (
            "Start Assessment →"
          )}
        </button>
      </motion.div>
    </div>
  );
}
