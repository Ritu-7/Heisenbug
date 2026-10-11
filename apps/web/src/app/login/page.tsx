"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { useQueryClient } from "@tanstack/react-query";
import { loginUser, getAuthToken, removeAuthToken } from "@/lib/api";
import { cn } from "@/lib/utils";

// ── Quick-fill Demo Profiles ───────────────────────────────────────────────

const PRESET_ACCOUNTS = [
  {
    role: "ADMIN",
    label: "Admin",
    badge: "Full Control",
    email: "admin@heisenbug.dev",
    password: "adminpassword123",
    description: "Manage problems, author tests, review system-wide candidates",
    target: "/admin/problems",
  },
  {
    role: "RECRUITER",
    label: "Recruiter",
    badge: "Hiring Manager",
    email: "recruiter@heisenbug.dev",
    password: "recruiterpassword123",
    description: "Create assessments, invite candidates, view reports & replay",
    target: "/recruiter/dashboard",
  },
  {
    role: "CANDIDATE",
    label: "Candidate",
    badge: "Test Taker",
    email: "alice@heisenbug.dev",
    password: "testcandidate123",
    description: "Take timed challenges, run tests in Docker, AI mentor practice",
    target: "/dashboard",
  },
];

function LoginFormContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const reduce = useReducedMotion();

  const redirectParam = searchParams.get("redirect");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async (e?: React.FormEvent, customEmail?: string, customPass?: string, customTarget?: string) => {
    if (e) e.preventDefault();
    setError(null);
    setLoading(true);

    const submitEmail = customEmail ?? email;
    const submitPass = customPass ?? password;

    try {
      const res = await loginUser(submitEmail.trim(), submitPass);
      // Invalidate the auth query cache so Nav and all pages immediately recognize the user
      await queryClient.invalidateQueries({ queryKey: ["me"] });
      await queryClient.invalidateQueries({ queryKey: ["sessions"] });
      await queryClient.invalidateQueries({ queryKey: ["assessments"] });

      // Determine redirect URL
      let target = redirectParam;
      if (!target) {
        if (customTarget) {
          target = customTarget;
        } else if (res.user.role === "ADMIN") {
          target = "/admin/problems";
        } else if (res.user.role === "RECRUITER") {
          target = "/recruiter/dashboard";
        } else {
          target = "/dashboard";
        }
      }

      router.push(target);
    } catch (err) {
      setError((err as Error).message || "Invalid credentials");
      setLoading(false);
    }
  };

  const selectPreset = (preset: typeof PRESET_ACCOUNTS[0]) => {
    setEmail(preset.email);
    setPassword(preset.password);
    setError(null);
    handleLogin(undefined, preset.email, preset.password, preset.target);
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
        <h1 className="text-xl font-semibold text-text">Sign in to your account</h1>
        <p className="text-xs text-text-secondary font-mono">
          JWT Authenticated · Role-Based Access (Admin / Recruiter / Candidate)
        </p>
      </div>

      {/* ── Main Form Card ── */}
      <motion.div
        initial={reduce ? false : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="rounded-xl border border-border bg-surface p-6 shadow-sm space-y-5"
      >
        <form onSubmit={(e) => handleLogin(e)} className="space-y-4">
          {/* Error Banner */}
          <AnimatePresence>
            {error && (
              <motion.div
                initial={reduce ? false : { opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="rounded-lg border border-fail/40 bg-fail-soft/20 px-3.5 py-2.5 text-xs text-fail font-mono flex items-start gap-2"
              >
                <span className="shrink-0 font-bold">⚠</span>
                <span className="flex-1">{error}</span>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Email input */}
          <div className="space-y-1.5">
            <label className="block text-xs font-mono font-medium text-text-secondary">
              Email address
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@domain.com"
              className={cn(
                "w-full px-3.5 py-2 rounded-lg text-sm bg-surface-2 border border-border text-text font-mono",
                "focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 transition-all",
                "placeholder:text-text-secondary/50",
              )}
            />
          </div>

          {/* Password input */}
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
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••••"
              className={cn(
                "w-full px-3.5 py-2 rounded-lg text-sm bg-surface-2 border border-border text-text font-mono",
                "focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 transition-all",
                "placeholder:text-text-secondary/50",
              )}
            />
          </div>

          {/* Submit Button */}
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
                <span>Authenticating with JWT...</span>
              </>
            ) : (
              <span>Sign In →</span>
            )}
          </button>
        </form>

        {/* ── Divider ── */}
        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-border" />
          </div>
          <div className="relative flex justify-center text-[10px] uppercase font-mono">
            <span className="bg-surface px-2 text-text-secondary">
              Or 1-Click Demo Login
            </span>
          </div>
        </div>

        {/* ── Role Preset Buttons ── */}
        <div className="space-y-2">
          {PRESET_ACCOUNTS.map((preset) => (
            <button
              key={preset.role}
              type="button"
              onClick={() => selectPreset(preset)}
              disabled={loading}
              className={cn(
                "w-full text-left p-3 rounded-lg border border-border bg-surface-2/60 hover:bg-surface-2 hover:border-accent/40",
                "transition-all group flex items-start justify-between gap-3 disabled:opacity-50",
              )}
            >
              <div className="space-y-0.5 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-text group-hover:text-accent transition-colors">
                    {preset.label}
                  </span>
                  <span className="px-1.5 py-0.2 rounded text-[10px] font-mono border border-border bg-surface text-text-secondary">
                    {preset.badge}
                  </span>
                </div>
                <p className="text-[11px] text-text-secondary font-mono truncate">
                  {preset.email}
                </p>
                <p className="text-[11px] text-text-secondary/80">
                  {preset.description}
                </p>
              </div>
              <span className="text-xs text-text-secondary group-hover:text-accent transition-colors shrink-0 mt-1">
                →
              </span>
            </button>
          ))}
        </div>
      </motion.div>

      {/* ── Security note ── */}
      <div className="text-center">
        <p className="text-[11px] font-mono text-text-secondary">
          Protected by signed HS256 JWT tokens & bcrypt password hashing.
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="min-h-[calc(100vh-140px)] flex items-center justify-center px-4 py-12">
      <Suspense
        fallback={
          <div className="text-center font-mono text-xs text-text-secondary animate-pulse">
            Loading authentication portal...
          </div>
        }
      >
        <LoginFormContent />
      </Suspense>
    </div>
  );
}
