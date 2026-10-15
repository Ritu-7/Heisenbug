import { SignIn } from "@clerk/nextjs";
import { DemoCredentialsCard } from "@/components/demo-credentials-card";

export default function CandidateLoginPage() {
  return (
    <div className="min-h-[calc(100vh-140px)] flex flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-md flex flex-col items-center">
        <div className="text-center mb-6">
          <h1 className="font-serif text-2xl font-bold tracking-tight text-text">
            Candidate Portal
          </h1>
          <p className="text-xs text-text-secondary mt-1">
            Sign in to solve real debugging problems, track your performance, and test your skills.
          </p>
        </div>

        <SignIn
          routing="hash"
          fallbackRedirectUrl="/dashboard"
          signUpFallbackRedirectUrl="/dashboard"
        />

        <DemoCredentialsCard
          roleTitle="Candidate Account"
          roleBadge="CANDIDATE"
          email="alice@heisenbug.dev"
          password="Heisenbug_Alice_Rotated_2026_Secure!"
          description="Pre-seeded candidate account with active practice sessions, hints history, and calibration metrics."
        />
      </div>
    </div>
  );
}
