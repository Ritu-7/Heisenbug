"use client";

import { useState } from "react";
import Link from "next/link";
import { SignIn, useUser } from "@clerk/nextjs";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchCurrentUser, requestRecruiterAccess } from "@/lib/api";
import { DemoCredentialsCard } from "@/components/demo-credentials-card";

export default function RecruiterLoginPage() {
  const queryClient = useQueryClient();
  const { isSignedIn, user: clerkUser, isLoaded } = useUser();
  const [requestMsg, setRequestMsg] = useState<string | null>(null);

  const { data: dbUser, isLoading: loadingDbUser } = useQuery({
    queryKey: ["me", isSignedIn],
    queryFn: fetchCurrentUser,
    enabled: isLoaded && !!isSignedIn,
    staleTime: 5 * 1000,
  });

  const requestMutation = useMutation({
    mutationFn: requestRecruiterAccess,
    onSuccess: (res) => {
      setRequestMsg(res.message);
      queryClient.invalidateQueries({ queryKey: ["me"] });
    },
    onError: (err: any) => {
      setRequestMsg(err.message || "Failed to request recruiter access");
    },
  });

  const isRecruiterOrAdmin = dbUser?.role === "RECRUITER" || dbUser?.role === "ADMIN";
  const isPending = dbUser?.approvalStatus === "PENDING";
  const isCandidate = dbUser?.role === "CANDIDATE";

  return (
    <div className="min-h-[calc(100vh-140px)] flex flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-md flex flex-col items-center">
        {/* Header */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded text-xs font-semibold uppercase tracking-wider bg-blue-500/10 text-blue-500 border border-blue-500/20 mb-2 font-mono">
            Recruiter Portal
          </div>
          <h1 className="font-serif text-2xl font-bold tracking-tight text-text">
            Hiring & Assessment Management
          </h1>
          <p className="text-xs text-text-secondary mt-1">
            Sign in to design candidate assessments, generate secure interview links, and evaluate submissions.
          </p>
        </div>

        {/* If signed in, evaluate role & approval status */}
        {isSignedIn ? (
          <div className="w-full rounded-xl border border-border bg-surface p-6 shadow-sm space-y-4 text-center">
            <div className="text-xs text-text-secondary font-mono">
              Signed in as <span className="text-text font-semibold">{clerkUser?.primaryEmailAddress?.emailAddress}</span>
            </div>

            {loadingDbUser ? (
              <p className="text-xs text-text-secondary py-4">Verifying recruiter privileges...</p>
            ) : isRecruiterOrAdmin ? (
              <div className="space-y-4">
                <div className="p-3 rounded-lg bg-pass-soft border border-pass-border text-pass text-xs">
                  ✓ Recruiter privileges verified (Role: <strong>{dbUser?.role}</strong>)
                </div>
                <Link
                  href="/recruiter/dashboard"
                  className="w-full py-2.5 px-4 rounded-lg bg-accent text-white font-medium text-xs hover:opacity-90 transition-opacity block text-center"
                >
                  Continue to Recruiter Dashboard →
                </Link>
              </div>
            ) : isPending ? (
              <div className="space-y-3">
                <div className="p-4 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-500 text-xs text-left space-y-1">
                  <div className="font-bold flex items-center gap-1.5">
                    <span>⏱</span> Recruiter Access Pending Approval
                  </div>
                  <p className="text-[11px] text-text-secondary leading-relaxed">
                    Your request for recruiter privileges has been submitted and is currently awaiting manual review by a system administrator.
                  </p>
                </div>
                <Link
                  href="/dashboard"
                  className="w-full py-2 px-3 rounded-lg border border-border text-text-secondary text-xs hover:bg-surface-2 transition-colors block text-center font-mono"
                >
                  Go to Candidate Dashboard
                </Link>
              </div>
            ) : isCandidate ? (
              <div className="space-y-4 text-left">
                <div className="p-4 rounded-lg bg-surface-2 border border-border text-xs space-y-2">
                  <div className="font-semibold text-text">Recruiter Privileges Required</div>
                  <p className="text-[11px] text-text-secondary leading-relaxed">
                    Your account currently holds the <strong>CANDIDATE</strong> role. To access recruiter capabilities, submit an access request for administrator review.
                  </p>
                </div>

                {requestMsg && (
                  <div className="p-3 rounded-lg bg-accent-soft border border-accent/20 text-accent text-xs font-mono">
                    {requestMsg}
                  </div>
                )}

                <button
                  onClick={() => requestMutation.mutate()}
                  disabled={requestMutation.isPending}
                  className="w-full py-2.5 px-4 rounded-lg bg-accent text-white font-medium text-xs hover:opacity-90 disabled:opacity-50 transition-opacity"
                >
                  {requestMutation.isPending ? "Submitting request..." : "Request Recruiter Access"}
                </button>
              </div>
            ) : null}
          </div>
        ) : (
          /* Clerk SignIn component for recruiters */
          <SignIn
            routing="hash"
            fallbackRedirectUrl="/recruiter/login"
            signUpFallbackRedirectUrl="/recruiter/login"
          />
        )}

        <DemoCredentialsCard
          roleTitle="Recruiter Demo Account"
          roleBadge="RECRUITER"
          email="recruiter@heisenbug.dev"
          password="Heisenbug_Recruiter_Rotated_2026_Secure!"
          description="Pre-approved recruiter account with existing assessments, candidate invitation tracking, and submission dashboards."
        />
      </div>
    </div>
  );
}
