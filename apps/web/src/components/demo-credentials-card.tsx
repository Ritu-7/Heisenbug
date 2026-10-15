"use client";

import { useState } from "react";

interface DemoCredentialsCardProps {
  roleTitle: string;
  email: string;
  password: string;
  roleBadge: string;
  description: string;
}

export function DemoCredentialsCard({
  roleTitle,
  email,
  password,
  roleBadge,
  description,
}: DemoCredentialsCardProps) {
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  return (
    <div className="w-full max-w-md mt-6 p-4 rounded-xl border border-border bg-surface shadow-sm text-xs space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-text">{roleTitle}</span>
          <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase bg-accent-soft text-accent border border-accent/20">
            {roleBadge}
          </span>
        </div>
        <span className="text-[10px] text-text-secondary font-mono">Demo Credentials</span>
      </div>

      <p className="text-text-secondary leading-relaxed">{description}</p>

      <div className="space-y-2 bg-surface-2 p-3 rounded-lg border border-border font-mono text-[11px]">
        <div className="flex items-center justify-between gap-2">
          <span className="text-text-secondary">Email:</span>
          <div className="flex items-center gap-2">
            <span className="text-text font-medium select-all">{email}</span>
            <button
              onClick={() => copyToClipboard(email, "email")}
              className="text-[10px] text-accent hover:underline shrink-0"
              title="Copy email"
            >
              {copiedField === "email" ? "Copied!" : "Copy"}
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border/50 pt-2">
          <span className="text-text-secondary">Password:</span>
          <div className="flex items-center gap-2">
            <span className="text-text font-medium select-all">{password}</span>
            <button
              onClick={() => copyToClipboard(password, "pass")}
              className="text-[10px] text-accent hover:underline shrink-0"
              title="Copy password"
            >
              {copiedField === "pass" ? "Copied!" : "Copy"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
