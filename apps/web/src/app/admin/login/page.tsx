"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { useQueryClient } from "@tanstack/react-query";
import { loginUser } from "@/lib/api";
import { cn } from "@/lib/utils";

function AdminLoginFormContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const reduce = useReducedMotion();

  const redirectParam = searchParams.get("redirect") || "/admin/problems";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e?: React.FormEvent, customEmail?: string, customPass?: string) => {
    if (e) e.preventDefault();
    setError(null);
    setLoading(true);

    const submitEmail = customEmail ?? email;
    const submitPass = customPass ?? password;

    try {
      const res = await loginUser(submitEmail.trim(), submitPass);
      await queryClient.invalidateQueries({ queryKey: ["me"] });

      if (res.user.role !== "ADMIN") {
        setError("Access denied: This account does not possess administrator credentials.");
        setLoading(false);
        return;
      }

      router.push(redirectParam);
    } catch (err) {
      setError((err as Error).message || "Invalid administrator credentials");
      setLoading(false);
    }
  };

  const fillAdminDemo = () => {
    setEmail("admin@heisenbug.dev");
    setPassword("adminpassword123");
    setError(null);
    handleSubmit(undefined, "admin@heisenbug.dev", "adminpassword123");
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
        <div className="flex items-center justify-center gap-2">
          <h1 className="text-xl font-semibold text-text">Administrator Console</h1>
          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-fail-soft/30 text-fail border border-fail/40 uppercase font-bold">
            Restricted
          </span>
        </div>
        <p className="text-xs text-text-secondary font-mono">
          Author problems · Inspect runners · System-wide configuration
        </p>
      </div>

      {/* ── Main Form Card ── */}
      <motion.div
        initial={reduce ? false : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="rounded-xl border border-border bg-surface p-6 shadow-sm space-y-5"
      >
        <div className="p-3 rounded-lg bg-surface-2/80 border border-border text-[11px] font-mono text-text-secondary leading-relaxed">
          <span className="text-accent font-semibold">Security policy:</span> Public registration and third-party OAuth are strictly disabled for administrative accounts.
        </div>

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

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="block text-xs font-mono font-medium text-text-secondary">
              Administrator Email
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@domain.com"
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
                Master Password
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
                <span>Verifying admin credentials...</span>
              </>
            ) : (
              <span>Sign In as Admin →</span>
            )}
          </button>
        </form>

        {/* ── Demo 1-Click Login Card (Admin) ── */}
        <div className="pt-2 border-t border-border space-y-2">
          <div className="flex items-center justify-between text-[11px] font-mono text-text-secondary">
            <span>Explore with seeded admin profile:</span>
            <span className="text-[10px] text-accent">Demo Access</span>
          </div>

          <button
            type="button"
            onClick={fillAdminDemo}
            disabled={loading}
            className={cn(
              "w-full text-left p-3 rounded-lg border border-border bg-surface-2/60 hover:bg-surface-2 hover:border-accent/40",
              "transition-all group flex items-start justify-between gap-3 disabled:opacity-50",
            )}
          >
            <div className="space-y-0.5 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-text group-hover:text-accent transition-colors">
                  Heisenbug Admin
                </span>
                <span className="px-1.5 py-0.2 rounded text-[10px] font-mono border border-border bg-surface text-text-secondary">
                  Full Control
                </span>
              </div>
              <p className="text-[11px] text-text-secondary font-mono truncate">
                admin@heisenbug.dev
              </p>
              <p className="text-[11px] text-text-secondary/80">
                Author new problem drafts, run 4-check validation, publish packs
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
          Candidate?{" "}
          <Link href="/login" className="text-accent hover:underline">
            Go to Candidate portal →
          </Link>
        </p>
        <p>
          Recruiter?{" "}
          <Link href="/recruiter/login" className="text-accent hover:underline">
            Go to Recruiter portal →
          </Link>
        </p>
      </div>
    </div>
  );
}

export default function AdminLoginPage() {
  return (
    <div className="min-h-[calc(100vh-140px)] flex items-center justify-center px-4 py-12">
      <Suspense
        fallback={
          <div className="text-center font-mono text-xs text-text-secondary animate-pulse">
            Loading admin console...
          </div>
        }
      >
        <AdminLoginFormContent />
      </Suspense>
    </div>
  );
}
