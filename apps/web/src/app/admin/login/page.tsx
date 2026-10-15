"use client";

import Link from "next/link";
import { SignIn, useUser } from "@clerk/nextjs";
import { useQuery } from "@tanstack/react-query";
import { fetchCurrentUser } from "@/lib/api";
import { DemoCredentialsCard } from "@/components/demo-credentials-card";

export default function AdminLoginPage() {
  const { isSignedIn, user: clerkUser, isLoaded } = useUser();

  const { data: dbUser, isLoading: loadingDbUser } = useQuery({
    queryKey: ["me", isSignedIn],
    queryFn: fetchCurrentUser,
    enabled: isLoaded && !!isSignedIn,
    staleTime: 5 * 1000,
  });

  const isAdmin = dbUser?.role === "ADMIN";

  return (
    <div className="min-h-[calc(100vh-140px)] flex flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-md flex flex-col items-center">
        {/* Header */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded text-xs font-semibold uppercase tracking-wider bg-purple-500/10 text-purple-400 border border-purple-500/20 mb-2 font-mono">
            <span>🛡</span> Restricted Console
          </div>
          <h1 className="font-serif text-2xl font-bold tracking-tight text-text">
            Administrator Console
          </h1>
          <p className="text-xs text-text-secondary mt-1">
            Author problems, run deterministic Docker validation suites, and manage recruiter permissions.
          </p>
        </div>

        {/* Security policy banner */}
        <div className="w-full p-3 mb-6 rounded-lg bg-surface-2 border border-border text-[11px] font-mono text-text-secondary leading-relaxed text-center">
          <span className="text-accent font-semibold">Security policy:</span> Self-serve administrative account creation is strictly prohibited. Administrative access is restricted to verified administrators.
        </div>

        {/* If signed in, evaluate ADMIN role */}
        {isSignedIn ? (
          <div className="w-full rounded-xl border border-border bg-surface p-6 shadow-sm space-y-4 text-center">
            <div className="text-xs text-text-secondary font-mono">
              Signed in as <span className="text-text font-semibold">{clerkUser?.primaryEmailAddress?.emailAddress}</span>
            </div>

            {loadingDbUser ? (
              <p className="text-xs text-text-secondary py-4">Verifying administrator privileges...</p>
            ) : isAdmin ? (
              <div className="space-y-4">
                <div className="p-3 rounded-lg bg-pass-soft border border-pass-border text-pass text-xs">
                  ✓ Administrator privileges verified (Role: <strong>ADMIN</strong>)
                </div>
                <Link
                  href="/admin/problems"
                  className="w-full py-2.5 px-4 rounded-lg bg-accent text-white font-medium text-xs hover:opacity-90 transition-opacity block text-center"
                >
                  Enter Admin Console →
                </Link>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="p-4 rounded-lg bg-fail-soft border border-fail-border text-fail text-xs text-left space-y-1">
                  <div className="font-bold flex items-center gap-1.5">
                    <span>⚠</span> Access Denied: Administrator Role Required
                  </div>
                  <p className="text-[11px] text-text-secondary leading-relaxed">
                    Account <strong>{clerkUser?.primaryEmailAddress?.emailAddress}</strong> holds role <strong>{dbUser?.role || "CANDIDATE"}</strong> and is not authorized to access administrative tools.
                  </p>
                </div>
                <Link
                  href="/dashboard"
                  className="w-full py-2 px-3 rounded-lg border border-border text-text-secondary text-xs hover:bg-surface-2 transition-colors block text-center font-mono"
                >
                  Return to Candidate Dashboard
                </Link>
              </div>
            )}
          </div>
        ) : (
          /* Clerk SignIn component for administrators with sign-up links suppressed */
          <SignIn
            routing="hash"
            fallbackRedirectUrl="/admin/login"
            signUpUrl={undefined}
            appearance={{
              elements: {
                footerAction: { display: "none" },
              },
            }}
          />
        )}

        <DemoCredentialsCard
          roleTitle="Administrator Account"
          roleBadge="ADMIN"
          email="admin@heisenbug.dev"
          password="Heisenbug_Admin_Rotated_2026_Secure!"
          description="Pre-seeded system administrator account with authoring privileges, LLM problem generators, and recruiter approval controls."
        />
      </div>
    </div>
  );
}
