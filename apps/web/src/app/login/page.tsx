"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import {
  loginUser,
  registerUser,
  fetchGoogleAuthConfig,
  setAuthToken,
} from "@/lib/api";
import { cn } from "@/lib/utils";

function CandidateLoginFormContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const reduce = useReducedMotion();

  const redirectParam = searchParams.get("redirect") || "/dashboard";
  const urlError = searchParams.get("error");

  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [isGoogleRedirecting, setIsGoogleRedirecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Sync and map query parameter error to human-friendly feedback
  useEffect(() => {
    if (urlError) {
      let friendly = decodeURIComponent(urlError);
      if (friendly === "access_denied") {
        friendly =
          "Google sign-in was cancelled or access was denied. If the OAuth consent screen is in 'Testing' mode, make sure your account is registered as a Test User in Google Cloud Console.";
      } else if (friendly.includes("redirect_uri_mismatch") || friendly.includes("redirect_uri")) {
        friendly =
          "Google OAuth redirect URI mismatch. Please ensure Authorized redirect URIs in Google Cloud Console match your application's backend callback URL.";
      } else if (friendly.includes("Google OAuth not configured")) {
        friendly =
          "Google Sign-In is not configured on the backend. GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET is missing.";
      }
      setError(friendly);
    }
  }, [urlError]);

  // Check if Google OAuth is configured
  const { data: googleConfig } = useQuery({
    queryKey: ["googleAuthConfig"],
    queryFn: fetchGoogleAuthConfig,
  });

  // Handle token returned via Google OAuth hash fragment
  useEffect(() => {
    if (typeof window !== "undefined" && window.location.hash.includes("token=")) {
      const match = window.location.hash.match(/token=([^&]+)/);
      if (match && match[1]) {
        const token = decodeURIComponent(match[1]);
        setAuthToken(token);
        // Clear fragment from address bar so JWT is not exposed in history
        window.history.replaceState(null, "", window.location.pathname + (window.location.search || ""));
        queryClient.invalidateQueries({ queryKey: ["me"] });
        router.push(redirectParam);
      }
    }
  }, [redirectParam, queryClient, router]);

  const handleSubmit = async (e?: React.FormEvent, customEmail?: string, customPass?: string) => {
    if (e) e.preventDefault();
    setError(null);
    setSuccessMsg(null);
    setLoading(true);

    const submitEmail = customEmail ?? email;
    const submitPass = customPass ?? password;

    try {
      if (mode === "login") {
        await loginUser(submitEmail.trim(), submitPass);
      } else {
        await registerUser({
          email: submitEmail.trim(),
          password: submitPass,
          name: name.trim() || submitEmail.split("@")[0],
          role: "CANDIDATE",
        });
      }

      await queryClient.invalidateQueries({ queryKey: ["me"] });
      await queryClient.invalidateQueries({ queryKey: ["sessions"] });
      router.push(redirectParam);
    } catch (err) {
      setError((err as Error).message || "Authentication failed");
      setLoading(false);
    }
  };

  const fillCandidateDemo = () => {
    setEmail("alice@heisenbug.dev");
    setPassword("testcandidate123");
    setMode("login");
    setError(null);
    handleSubmit(undefined, "alice@heisenbug.dev", "testcandidate123");
  };

  return (
    <div className="w-full max-w-md mx-auto space-y-6">
      {/* ── Brand Header ── */}
      <div className="text-center space-y-2">
        <Link href="/" className="inline-flex items-center gap-2 group">
          <span className="h-3 w-3 rounded-full bg-accent group-hover:scale-110 transition-transform" />
          <span className="font-serif text-2xl font-bold tracking-tight text-text">
            Heisenbug
          </span>
        </Link>
        <h1 className="text-xl font-semibold text-text">
          {mode === "login" ? "Candidate Portal" : "Create Candidate Account"}
        </h1>
        <p className="text-xs text-text-secondary font-mono">
          Solve tickets · Practice with AI mentor · Track calibration
        </p>
      </div>

      {/* ── Main Form Card ── */}
      <motion.div
        initial={reduce ? false : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="rounded-xl border border-border bg-surface p-6 shadow-sm space-y-5"
      >
        {/* Mode Toggle Tabs */}
        <div className="grid grid-cols-2 p-1 rounded-lg bg-surface-2 border border-border text-xs font-mono">
          <button
            type="button"
            onClick={() => {
              setMode("login");
              setError(null);
            }}
            className={cn(
              "py-1.5 rounded-md font-semibold transition-all",
              mode === "login" ? "bg-surface text-text shadow-sm" : "text-text-secondary hover:text-text",
            )}
          >
            Sign In
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("register");
              setError(null);
            }}
            className={cn(
              "py-1.5 rounded-md font-semibold transition-all",
              mode === "register" ? "bg-surface text-text shadow-sm" : "text-text-secondary hover:text-text",
            )}
          >
            Create Account
          </button>
        </div>

        {/* Error / Success Banners */}
        <AnimatePresence>
          {error && (
            <motion.div
              initial={reduce ? false : { opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="rounded-lg border border-fail/40 bg-fail-soft/20 px-3.5 py-2.5 text-xs text-fail font-mono flex items-start justify-between gap-2"
            >
              <div className="flex items-start gap-2 min-w-0 flex-1">
                <span className="shrink-0 font-bold">⚠</span>
                <span className="flex-1 leading-relaxed whitespace-pre-wrap">{error}</span>
              </div>
              <button
                type="button"
                onClick={() => setError(null)}
                className="text-fail/60 hover:text-fail text-sm font-bold shrink-0 ml-1 leading-none"
                title="Dismiss"
              >
                ✕
              </button>
            </motion.div>
          )}
          {successMsg && (
            <motion.div
              initial={reduce ? false : { opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="rounded-lg border border-pass/40 bg-pass-soft/20 px-3.5 py-2.5 text-xs text-pass font-mono flex items-start gap-2"
            >
              <span className="shrink-0 font-bold">✓</span>
              <span className="flex-1">{successMsg}</span>
            </motion.div>
          )}
        </AnimatePresence>

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === "register" && (
            <div className="space-y-1.5">
              <label className="block text-xs font-mono font-medium text-text-secondary">
                Full name
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Alice Walker"
                className={cn(
                  "w-full px-3.5 py-2 rounded-lg text-sm bg-surface-2 border border-border text-text font-mono",
                  "focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 transition-all",
                  "placeholder:text-text-secondary/50",
                )}
              />
            </div>
          )}

          <div className="space-y-1.5">
            <label className="block text-xs font-mono font-medium text-text-secondary">
              Email address
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="candidate@example.com"
              className={cn(
                "w-full px-3.5 py-2 rounded-lg text-sm bg-surface-2 border border-border text-text font-mono",
                "focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 transition-all",
                "placeholder:text-text-secondary/50",
              )}
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-mono font-medium text-text-secondary">
                Password
              </label>
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="text-[11px] font-mono text-text-secondary hover:text-text transition-colors"
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
            <input
              type={showPassword ? "text" : "password"}
              required
              minLength={mode === "register" ? 8 : 1}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === "register" ? "Minimum 8 characters" : "••••••••••••"}
              className={cn(
                "w-full px-3.5 py-2 rounded-lg text-sm bg-surface-2 border border-border text-text font-mono",
                "focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 transition-all",
                "placeholder:text-text-secondary/50",
              )}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className={cn(
              "w-full py-2.5 px-4 rounded-lg text-xs font-mono font-semibold transition-all",
              "bg-accent text-white hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed",
              "shadow-sm flex items-center justify-center gap-2",
            )}
          >
            {loading ? (
              <>
                <span className="h-3.5 w-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                <span>{mode === "login" ? "Signing In..." : "Creating Account..."}</span>
              </>
            ) : (
              <span>{mode === "login" ? "Sign In →" : "Register Candidate →"}</span>
            )}
          </button>
        </form>

        {/* ── Google OAuth Button (Shown only when configured) ── */}
        {googleConfig?.configured && (
          <div className="space-y-3 pt-1">
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-border" />
              </div>
              <div className="relative flex justify-center text-[10px] uppercase font-mono">
                <span className="bg-surface px-2 text-text-secondary">Or continue with</span>
              </div>
            </div>

            <a
              href={`${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001"}/api/auth/google?context=candidate${redirectParam ? `&redirect=${encodeURIComponent(redirectParam)}` : ""}`}
              onClick={() => setIsGoogleRedirecting(true)}
              className={cn(
                "w-full py-2 px-4 rounded-lg text-xs font-mono font-medium transition-all",
                "bg-surface-2 border border-border text-text hover:bg-surface hover:border-accent/40",
                "flex items-center justify-center gap-2.5",
                isGoogleRedirecting && "opacity-75 pointer-events-none",
              )}
            >
              {isGoogleRedirecting ? (
                <>
                  <span className="h-3.5 w-3.5 rounded-full border-2 border-accent/30 border-t-accent animate-spin" />
                  <span>Connecting to Google...</span>
                </>
              ) : (
                <>
                  <svg className="h-4 w-4" viewBox="0 0 24 24">
                    <path
                      fill="#4285F4"
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    />
                    <path
                      fill="#34A853"
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                    />
                    <path
                      fill="#EA4335"
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                    />
                  </svg>
                  <span>Sign in with Google</span>
                </>
              )}
            </a>
          </div>
        )}

        {/* ── Demo 1-Click Login Card (Alice) ── */}
        <div className="pt-2 border-t border-border space-y-2">
          <div className="flex items-center justify-between text-[11px] font-mono text-text-secondary">
            <span>Or explore with demo profile:</span>
            <span className="text-[10px] text-accent">Instant</span>
          </div>

          <button
            type="button"
            onClick={fillCandidateDemo}
            disabled={loading}
            className={cn(
              "w-full text-left p-3 rounded-lg border border-border bg-surface-2/60 hover:bg-surface-2 hover:border-accent/40",
              "transition-all group flex items-start justify-between gap-3 disabled:opacity-50",
            )}
          >
            <div className="space-y-0.5 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-text group-hover:text-accent transition-colors">
                  Alice (Candidate)
                </span>
                <span className="px-1.5 py-0.2 rounded text-[10px] font-mono border border-border bg-surface text-text-secondary">
                  Test Taker
                </span>
              </div>
              <p className="text-[11px] text-text-secondary font-mono truncate">
                alice@heisenbug.dev
              </p>
              <p className="text-[11px] text-text-secondary/80">
                100/100 solved session, AI mentor collaboration, calibration gap stats
              </p>
            </div>
            <span className="text-xs text-text-secondary group-hover:text-accent transition-colors shrink-0 mt-1">
              →
            </span>
          </button>
        </div>
      </motion.div>

      {/* Role Switcher Links */}
      <div className="text-center space-y-1 text-xs font-mono text-text-secondary">
        <p>
          Hiring manager?{" "}
          <Link href="/recruiter/login" className="text-accent hover:underline">
            Go to Recruiter portal →
          </Link>
        </p>
        <p>
          System administrator?{" "}
          <Link href="/admin/login" className="text-accent hover:underline">
            Admin login →
          </Link>
        </p>
      </div>
    </div>
  );
}

export default function CandidateLoginPage() {
  return (
    <div className="min-h-[calc(100vh-140px)] flex items-center justify-center px-4 py-12">
      <Suspense
        fallback={
          <div className="text-center font-mono text-xs text-text-secondary animate-pulse">
            Loading candidate portal...
          </div>
        }
      >
        <CandidateLoginFormContent />
      </Suspense>
    </div>
  );
}
