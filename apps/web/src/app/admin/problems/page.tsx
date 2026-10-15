"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  draftProblem,
  validateProblemDraft,
  publishProblemDraft,
  fetchAdminProblems,
  fetchAdminUsers,
  approveRecruiter,
  rejectRecruiter,
  type Problem,
  type ValidationResponse,
  type AdminUser,
} from "@/lib/api";
import { cn } from "@/lib/utils";

export default function AdminProblemAuthoringPage() {
  const queryClient = useQueryClient();

  // Tab state
  const [activeTab, setActiveTab] = useState<"problems" | "approvals">("problems");

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
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Queries
  const { data: problems, isLoading: loadingProblems } = useQuery({
    queryKey: ["adminProblems"],
    queryFn: async () => {
      return fetchAdminProblems();
    },
  });

  const { data: users = [], isLoading: loadingUsers } = useQuery({
    queryKey: ["adminUsers"],
    queryFn: async () => {
      return fetchAdminUsers();
    },
  });

  // Approvals mutations
  const approveMutation = useMutation({
    mutationFn: async (userId: string) => {
      setErrorMessage(null);
      setSuccessMessage(null);
      return approveRecruiter(userId);
    },
    onSuccess: (res) => {
      setSuccessMessage(res.message || "Recruiter approved successfully");
      queryClient.invalidateQueries({ queryKey: ["adminUsers"] });
    },
    onError: (err: any) => {
      setErrorMessage(err.message || "Failed to approve recruiter");
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async (userId: string) => {
      setErrorMessage(null);
      setSuccessMessage(null);
      return rejectRecruiter(userId);
    },
    onSuccess: (res) => {
      setSuccessMessage(res.message || "Recruiter request rejected");
      queryClient.invalidateQueries({ queryKey: ["adminUsers"] });
    },
    onError: (err: any) => {
      setErrorMessage(err.message || "Failed to reject recruiter");
    },
  });

  // Draft mutation
  const draftMutation = useMutation({
    mutationFn: async () => {
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
  const pendingUsers = users.filter((u) => u.approvalStatus === "PENDING");

  return (
    <div className="min-h-screen bg-[var(--surface-base)] text-[var(--text-primary)] px-6 py-10 max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-8 border-b border-[var(--border-subtle)] pb-6">
        <div className="flex items-center gap-3 mb-2">
          <span className="px-2.5 py-0.5 rounded text-xs font-semibold uppercase tracking-wider bg-[var(--accent-subtle)] text-[var(--accent)] border border-[var(--accent-border)]">
            Admin Console
          </span>
          <span className="text-xs text-[var(--text-tertiary)] font-mono">
            Problem Packs • Recruiter Approvals • Synced Users
          </span>
        </div>
        <h1 className="text-3xl font-bold tracking-tight">Admin & Author Management</h1>
        <p className="text-[var(--text-secondary)] text-sm mt-1">
          Review recruiter access requests, manage user roles in Clerk, and author executable problem packs with deterministic Docker validation.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-6 mb-6 border-b border-[var(--border-subtle)]">
        <button
          onClick={() => setActiveTab("problems")}
          className={cn(
            "pb-3 text-sm font-medium border-b-2 transition-colors",
            activeTab === "problems"
              ? "border-[var(--accent)] text-[var(--accent)] font-semibold"
              : "border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          )}
        >
          Problem Pack Studio
        </button>
        <button
          onClick={() => setActiveTab("approvals")}
          className={cn(
            "pb-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-2",
            activeTab === "approvals"
              ? "border-[var(--accent)] text-[var(--accent)] font-semibold"
              : "border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          )}
        >
          <span>Recruiter Requests & Users</span>
          {pendingUsers.length > 0 && (
            <span className="px-2 py-0.5 rounded-full text-[11px] font-mono font-bold bg-amber-500/20 text-amber-500 border border-amber-500/30">
              {pendingUsers.length}
            </span>
          )}
        </button>
      </div>

      {errorMessage && (
        <div className="mb-6 p-4 rounded-lg bg-[var(--fail-soft)] border border-[var(--fail-border)] text-[var(--fail)] text-sm">
          <strong>Error:</strong> {errorMessage}
        </div>
      )}

      {successMessage && (
        <div className="mb-6 p-4 rounded-lg bg-[var(--pass-soft)] border border-[var(--pass-border)] text-[var(--pass)] text-sm">
          <strong>Success:</strong> {successMessage}
        </div>
      )}

      {activeTab === "problems" ? (
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
      ) : (
        <div className="space-y-8">
          {/* Pending Recruiter Requests Card */}
          <div className="p-6 rounded-xl bg-[var(--surface-elevated)] border border-[var(--border-subtle)] shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-semibold">Pending Recruiter Access Requests</h2>
                <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                  Candidates who have submitted a recruiter access request. Approving sets role to RECRUITER in Clerk private metadata.
                </p>
              </div>
              <span className="px-2.5 py-1 rounded-full text-xs font-mono font-bold bg-amber-500/10 text-amber-500 border border-amber-500/20">
                {pendingUsers.length} Pending
              </span>
            </div>

            {loadingUsers ? (
              <p className="text-xs text-[var(--text-tertiary)] py-4">Loading user requests...</p>
            ) : pendingUsers.length === 0 ? (
              <div className="p-8 rounded-lg border border-dashed border-[var(--border-subtle)] text-center text-[var(--text-tertiary)] text-sm">
                No pending recruiter access requests at this time.
              </div>
            ) : (
              <div className="divide-y divide-[var(--border-subtle)]">
                {pendingUsers.map((u) => (
                  <div key={u.id} className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm text-[var(--text-primary)]">{u.name}</span>
                        <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase bg-amber-500/20 text-amber-500 border border-amber-500/30">
                          {u.requestedRole || "RECRUITER"} REQUESTED
                        </span>
                      </div>
                      <div className="text-xs font-mono text-[var(--text-secondary)] mt-0.5">
                        {u.email} • ID: <span className="opacity-70">{u.id}</span>
                      </div>
                      <div className="text-[11px] text-[var(--text-tertiary)] mt-1">
                        Requested: {new Date(u.createdAt).toLocaleDateString()}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => approveMutation.mutate(u.id)}
                        disabled={approveMutation.isPending || rejectMutation.isPending}
                        className="px-3 py-1.5 rounded-lg bg-[var(--pass)] hover:opacity-90 text-white text-xs font-semibold shadow-sm transition-all flex items-center gap-1.5"
                      >
                        {approveMutation.isPending ? "Approving..." : "Approve as Recruiter"}
                      </button>
                      <button
                        onClick={() => rejectMutation.mutate(u.id)}
                        disabled={approveMutation.isPending || rejectMutation.isPending}
                        className="px-3 py-1.5 rounded-lg bg-[var(--fail-soft)] hover:bg-[var(--fail)] hover:text-white text-[var(--fail)] border border-[var(--fail-border)] text-xs font-medium transition-all"
                      >
                        {rejectMutation.isPending ? "Rejecting..." : "Reject"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* All Users Directory Card */}
          <div className="p-6 rounded-xl bg-[var(--surface-elevated)] border border-[var(--border-subtle)] shadow-sm">
            <h2 className="text-lg font-semibold mb-1">Registered Users Directory</h2>
            <p className="text-xs text-[var(--text-secondary)] mb-4">
              All users synced from Clerk into the Postgres mirror database.
            </p>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-[var(--border-subtle)] text-[var(--text-tertiary)] font-mono">
                    <th className="py-2.5 px-3">User</th>
                    <th className="py-2.5 px-3">Role</th>
                    <th className="py-2.5 px-3">Approval Status</th>
                    <th className="py-2.5 px-3">Activity</th>
                    <th className="py-2.5 px-3">Created</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-subtle)]">
                  {users.map((u) => (
                    <tr key={u.id} className="hover:bg-[var(--surface-base)] transition-colors">
                      <td className="py-2.5 px-3">
                        <div className="font-medium text-[var(--text-primary)]">{u.name}</div>
                        <div className="font-mono text-[var(--text-tertiary)] text-[11px]">{u.email}</div>
                      </td>
                      <td className="py-2.5 px-3">
                        <span className={cn(
                          "px-2 py-0.5 rounded text-[10px] font-semibold uppercase",
                          u.role === "ADMIN" ? "bg-purple-500/20 text-purple-400 border border-purple-500/30" :
                          u.role === "RECRUITER" ? "bg-blue-500/20 text-blue-400 border border-blue-500/30" :
                          u.role === "AUTHOR" ? "bg-amber-500/20 text-amber-400 border border-amber-500/30" :
                          "bg-zinc-700/30 text-zinc-300 border border-zinc-700"
                        )}>
                          {u.role}
                        </span>
                      </td>
                      <td className="py-2.5 px-3">
                        <span className={cn(
                          "px-2 py-0.5 rounded text-[10px] font-semibold uppercase",
                          u.approvalStatus === "APPROVED" ? "text-[var(--pass)] bg-[var(--pass-soft)] border border-[var(--pass-border)]" :
                          u.approvalStatus === "PENDING" ? "text-amber-400 bg-amber-500/20 border border-amber-500/30 font-bold" :
                          u.approvalStatus === "REJECTED" ? "text-[var(--fail)] bg-[var(--fail-soft)] border border-[var(--fail-border)]" :
                          "text-[var(--text-tertiary)]"
                        )}>
                          {u.approvalStatus}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 font-mono text-[11px] text-[var(--text-secondary)]">
                        {u._count ? `${u._count.sessions} sess / ${u._count.assessments} asmt` : "—"}
                      </td>
                      <td className="py-2.5 px-3 text-[11px] text-[var(--text-tertiary)]">
                        {new Date(u.createdAt).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
