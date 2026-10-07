"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  draftProblem,
  validateProblemDraft,
  publishProblemDraft,
  fetchAdminProblems,
  loginUser,
  getAuthToken,
  type Problem,
  type ValidationResponse,
} from "@/lib/api";
import { cn } from "@/lib/utils";

export default function AdminProblemAuthoringPage() {
  const queryClient = useQueryClient();

  // Form state
  const [brief, setBrief] = useState("");
  const [track, setTrack] = useState("backend");
  const [difficulty, setDifficulty] = useState("medium");
  const [customSlug, setCustomSlug] = useState("");

  // Active drafted problem state
  const [activeSlug, setActiveSlug] = useState<string | null>(null);
  const [draftData, setDraftData] = useState<any>(null);
  const [validationResult, setValidationResult] = useState<ValidationResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Auto-authenticate as admin if no token in dev
  const ensureAdminAuth = async () => {
    if (!getAuthToken()) {
      await loginUser("admin@heisenbug.dev", "adminpassword123");
    }
  };

  // Queries
  const { data: problems, isLoading: loadingProblems } = useQuery({
    queryKey: ["adminProblems"],
    queryFn: async () => {
      await ensureAdminAuth();
      return fetchAdminProblems();
    },
  });

  // Draft mutation
  const draftMutation = useMutation({
    mutationFn: async () => {
      await ensureAdminAuth();
      setErrorMessage(null);
      setValidationResult(null);
      return draftProblem({
        brief,
        track,
        difficulty,
        slug: customSlug.trim() || undefined,
      });
    },
    onSuccess: (res) => {
      setDraftData(res.data);
      setActiveSlug(res.data.slug);
      queryClient.invalidateQueries({ queryKey: ["adminProblems"] });
    },
    onError: (err: any) => {
      setErrorMessage(err.message || "Failed to generate draft");
    },
  });

  // Validate mutation
  const validateMutation = useMutation({
    mutationFn: async (slug: string) => {
      await ensureAdminAuth();
      setErrorMessage(null);
      return validateProblemDraft(slug);
    },
    onSuccess: (res) => {
      setValidationResult(res);
    },
    onError: (err: any) => {
      setErrorMessage(err.message || "Validation failed to run");
    },
  });

  // Publish mutation
  const publishMutation = useMutation({
    mutationFn: async (slug: string) => {
      await ensureAdminAuth();
      setErrorMessage(null);
      return publishProblemDraft(slug);
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["adminProblems"] });
      if (draftData && draftData.slug === res.slug) {
        setDraftData({ ...draftData, status: "PUBLISHED" });
      }
    },
    onError: (err: any) => {
      setErrorMessage(err.message || "Publishing failed");
    },
  });

  const allPassed = validationResult?.allPassed ?? false;

  return (
    <div className="min-h-screen bg-[var(--surface-base)] text-[var(--text-primary)] px-6 py-10 max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-8 border-b border-[var(--border-subtle)] pb-6">
        <div className="flex items-center gap-3 mb-2">
          <span className="px-2.5 py-0.5 rounded text-xs font-semibold uppercase tracking-wider bg-[var(--accent-subtle)] text-[var(--accent)] border border-[var(--accent-border)]">
            Admin Authoring
          </span>
          <span className="text-xs text-[var(--text-tertiary)] font-mono">
            Pipeline: LLM Draft → Docker 4-Check Validate → Publish
          </span>
        </div>
        <h1 className="text-3xl font-bold tracking-tight">AI-Assisted Problem Pack Studio</h1>
        <p className="text-[var(--text-secondary)] text-sm mt-1">
          Draft complete executable problem packs using LLMs, verify them through the deterministic Docker validation pipeline, and publish on a verified pass.
        </p>
      </div>

      {errorMessage && (
        <div className="mb-6 p-4 rounded-lg bg-[var(--fail-soft)] border border-[var(--fail-border)] text-[var(--fail)] text-sm">
          <strong>Error:</strong> {errorMessage}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Column: Brief Input Form */}
        <div className="lg:col-span-1 space-y-6">
          <div className="p-6 rounded-xl bg-[var(--surface-elevated)] border border-[var(--border-subtle)] shadow-sm">
            <h2 className="text-lg font-semibold mb-4">1. Author Brief</h2>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                  Problem Brief / Bug Scenario
                </label>
                <textarea
                  rows={4}
                  value={brief}
                  onChange={(e) => setBrief(e.target.value)}
                  placeholder="e.g. A backend issue where fetching the orders list makes an N+1 query explosion to load customer profiles..."
                  className="w-full px-3 py-2 rounded-lg bg-[var(--surface-base)] border border-[var(--border-default)] text-sm focus:outline-none focus:border-[var(--accent)] text-[var(--text-primary)]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                    Track
                  </label>
                  <select
                    value={track}
                    onChange={(e) => setTrack(e.target.value)}
                    className="w-full px-3 py-1.5 rounded-lg bg-[var(--surface-base)] border border-[var(--border-default)] text-sm text-[var(--text-primary)]"
                  >
                    <option value="backend">Backend</option>
                    <option value="security">Security</option>
                    <option value="ml">Machine Learning</option>
                    <option value="frontend">Frontend</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                    Difficulty
                  </label>
                  <select
                    value={difficulty}
                    onChange={(e) => setDifficulty(e.target.value)}
                    className="w-full px-3 py-1.5 rounded-lg bg-[var(--surface-base)] border border-[var(--border-default)] text-sm text-[var(--text-primary)]"
                  >
                    <option value="easy">Easy</option>
                    <option value="medium">Medium</option>
                    <option value="hard">Hard</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                  Optional Custom Slug
                </label>
                <input
                  type="text"
                  value={customSlug}
                  onChange={(e) => setCustomSlug(e.target.value)}
                  placeholder="e.g. be-nplusone-001"
                  className="w-full px-3 py-1.5 rounded-lg bg-[var(--surface-base)] border border-[var(--border-default)] text-sm text-[var(--text-primary)] font-mono"
                />
              </div>

              <button
                onClick={() => draftMutation.mutate()}
                disabled={brief.trim().length < 10 || draftMutation.isPending}
                className={cn(
                  "w-full py-2.5 px-4 rounded-lg font-medium text-sm transition-all duration-150 flex items-center justify-center gap-2",
                  brief.trim().length >= 10 && !draftMutation.isPending
                    ? "bg-[var(--accent)] text-white hover:opacity-90"
                    : "bg-[var(--surface-subtle)] text-[var(--text-tertiary)] cursor-not-allowed"
                )}
              >
                {draftMutation.isPending ? (
                  <>
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                    Generating Problem Pack...
                  </>
                ) : (
                  "Generate Draft with AI"
                )}
              </button>
            </div>
          </div>

          {/* Existing Problems List */}
          <div className="p-5 rounded-xl bg-[var(--surface-elevated)] border border-[var(--border-subtle)]">
            <h3 className="text-sm font-semibold mb-3">All Problem Packs</h3>
            {loadingProblems ? (
              <p className="text-xs text-[var(--text-tertiary)]">Loading problem packs...</p>
            ) : (
              <div className="space-y-2">
                {problems?.map((p) => {
                  const status = p.currentVersion?.status ?? "DRAFT";
                  const isCurrent = activeSlug === p.slug;
                  return (
                    <div
                      key={p.slug}
                      onClick={() => {
                        setActiveSlug(p.slug);
                        setDraftData(p);
                        setValidationResult(null);
                      }}
                      className={cn(
                        "p-2.5 rounded-lg border text-xs cursor-pointer transition-all flex items-center justify-between",
                        isCurrent
                          ? "border-[var(--accent)] bg-[var(--accent-subtle)]"
                          : "border-[var(--border-subtle)] hover:border-[var(--border-default)]"
                      )}
                    >
                      <div className="truncate mr-2">
                        <div className="font-mono font-medium truncate">{p.slug}</div>
                        <div className="text-[var(--text-tertiary)] truncate">{p.title}</div>
                      </div>
                      <span
                        className={cn(
                          "px-2 py-0.5 rounded text-[10px] font-semibold shrink-0 uppercase",
                          status === "PUBLISHED"
                            ? "bg-[var(--pass-soft)] text-[var(--pass)] border border-[var(--pass-border)]"
                            : "bg-[var(--warning-soft)] text-[var(--warning)] border border-[var(--warning-border)]"
                        )}
                      >
                        {status}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Draft Details, Validation & Publishing */}
        <div className="lg:col-span-2 space-y-6">
          {activeSlug ? (
            <div className="p-6 rounded-xl bg-[var(--surface-elevated)] border border-[var(--border-subtle)] shadow-sm space-y-6">
              {/* Draft Header */}
              <div className="flex items-start justify-between pb-4 border-b border-[var(--border-subtle)]">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-mono text-sm font-semibold text-[var(--accent)]">{activeSlug}</span>
                    <span
                      className={cn(
                        "px-2 py-0.5 rounded text-xs font-semibold uppercase",
                        draftData?.status === "PUBLISHED" || draftData?.currentVersion?.status === "PUBLISHED"
                          ? "bg-[var(--pass-soft)] text-[var(--pass)] border border-[var(--pass-border)]"
                          : "bg-[var(--warning-soft)] text-[var(--warning)] border border-[var(--warning-border)]"
                      )}
                    >
                      {draftData?.status || draftData?.currentVersion?.status || "DRAFT"}
                    </span>
                  </div>
                  <h3 className="text-xl font-bold">{draftData?.title}</h3>
                  <div className="flex gap-3 text-xs text-[var(--text-secondary)] mt-2">
                    <span>Track: <strong>{draftData?.track}</strong></span>
                    <span>Difficulty: <strong>{draftData?.difficulty}</strong></span>
                    <span>Stack: <strong>{draftData?.stack}</strong></span>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex gap-2">
                  <button
                    onClick={() => validateMutation.mutate(activeSlug)}
                    disabled={validateMutation.isPending}
                    className="px-4 py-2 rounded-lg text-xs font-semibold bg-[var(--surface-base)] border border-[var(--border-default)] hover:border-[var(--accent)] transition-all flex items-center gap-1.5"
                  >
                    {validateMutation.isPending ? "Validating (Docker)..." : "2. Run Validation"}
                  </button>

                  <button
                    onClick={() => publishMutation.mutate(activeSlug)}
                    disabled={!allPassed || publishMutation.isPending || (draftData?.status === "PUBLISHED")}
                    className={cn(
                      "px-4 py-2 rounded-lg text-xs font-semibold transition-all",
                      allPassed && draftData?.status !== "PUBLISHED"
                        ? "bg-[var(--pass)] text-white hover:opacity-90 cursor-pointer"
                        : "bg-[var(--surface-subtle)] text-[var(--text-tertiary)] cursor-not-allowed"
                    )}
                  >
                    {publishMutation.isPending
                      ? "Publishing..."
                      : draftData?.status === "PUBLISHED"
                      ? "Published ✓"
                      : "3. Publish to Catalog"}
                  </button>
                </div>
              </div>

              {/* Validation Results Card */}
              {validationResult && (
                <div className="space-y-4">
                  <h4 className="text-sm font-semibold text-[var(--text-primary)]">
                    Docker Pipeline Verification Results
                  </h4>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div
                      className={cn(
                        "p-3 rounded-lg border text-xs",
                        validationResult.checks.check1
                          ? "bg-[var(--pass-soft)] border-[var(--pass-border)] text-[var(--pass)]"
                          : "bg-[var(--fail-soft)] border-[var(--fail-border)] text-[var(--fail)]"
                      )}
                    >
                      <div className="font-bold">Check 1</div>
                      <div>Starter fails hidden</div>
                      <div className="mt-1 font-mono font-semibold">
                        {validationResult.checks.check1 ? "✓ PASSED" : "✗ FAILED"}
                      </div>
                    </div>

                    <div
                      className={cn(
                        "p-3 rounded-lg border text-xs",
                        validationResult.checks.check2
                          ? "bg-[var(--pass-soft)] border-[var(--pass-border)] text-[var(--pass)]"
                          : "bg-[var(--fail-soft)] border-[var(--fail-border)] text-[var(--fail)]"
                      )}
                    >
                      <div className="font-bold">Check 2</div>
                      <div>Reference scores 100</div>
                      <div className="mt-1 font-mono font-semibold">
                        {validationResult.checks.check2 ? "✓ PASSED" : "✗ FAILED"}
                      </div>
                    </div>

                    <div
                      className={cn(
                        "p-3 rounded-lg border text-xs",
                        validationResult.checks.check3
                          ? "bg-[var(--pass-soft)] border-[var(--pass-border)] text-[var(--pass)]"
                          : "bg-[var(--fail-soft)] border-[var(--fail-border)] text-[var(--fail)]"
                      )}
                    >
                      <div className="font-bold">Check 3</div>
                      <div>Grader 5× consistency</div>
                      <div className="mt-1 font-mono font-semibold">
                        {validationResult.checks.check3 ? "✓ PASSED" : "✗ FAILED"}
                      </div>
                    </div>

                    <div
                      className={cn(
                        "p-3 rounded-lg border text-xs",
                        validationResult.checks.check4
                          ? "bg-[var(--pass-soft)] border-[var(--pass-border)] text-[var(--pass)]"
                          : "bg-[var(--fail-soft)] border-[var(--fail-border)] text-[var(--fail)]"
                      )}
                    >
                      <div className="font-bold">Check 4</div>
                      <div>Bad patch rejected</div>
                      <div className="mt-1 font-mono font-semibold">
                        {validationResult.checks.check4 ? "✓ PASSED" : "✗ FAILED"}
                      </div>
                    </div>
                  </div>

                  {/* Terminal log output */}
                  <div>
                    <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
                      validate.ts Execution Log
                    </label>
                    <pre className="p-4 rounded-lg bg-black text-green-400 font-mono text-xs overflow-x-auto max-h-80 border border-[var(--border-subtle)] whitespace-pre-wrap">
                      {validationResult.output}
                    </pre>
                  </div>
                </div>
              )}

              {/* Problem Description Preview */}
              {draftData?.descriptionMd && (
                <div className="pt-4 border-t border-[var(--border-subtle)]">
                  <h4 className="text-sm font-semibold mb-2">Ticket Description Preview</h4>
                  <div className="p-4 rounded-lg bg-[var(--surface-base)] border border-[var(--border-subtle)] text-xs text-[var(--text-secondary)] whitespace-pre-wrap max-h-60 overflow-y-auto">
                    {draftData.descriptionMd}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="p-12 rounded-xl bg-[var(--surface-elevated)] border border-dashed border-[var(--border-default)] text-center text-[var(--text-tertiary)]">
              <p className="text-sm">No problem pack selected.</p>
              <p className="text-xs mt-1">Enter a brief on the left to draft a new problem, or select an existing pack.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
