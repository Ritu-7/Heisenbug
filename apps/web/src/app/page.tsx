"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { CodeEditor } from "@/components/code-editor";
import { cn } from "@/lib/utils";

// ── Real starter code snippet from be-idempotency-001 (PAY-482) ────────────
const SAMPLE_CODE = `// src/charge.js — Checkout payment processing
// PAY-482: Fix double-charges on client retry

'use strict';

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { db } = require('./db/client');

async function handleCheckout(req, res) {
  const { cartId, amount, currency = 'usd', customerId } = req.body;

  // TODO R1: Read & validate Idempotency-Key header
  const idempotencyKey = req.headers['idempotency-key'];
  if (!idempotencyKey) {
    return res.status(400).json({ error: 'Idempotency-Key header is required' });
  }

  // TODO R2: Check if key was already processed (replay check)
  const existing = await db.idempotencyKey.findUnique({ where: { key: idempotencyKey } });
  if (existing?.responseBody) {
    return res.status(200).json(JSON.parse(existing.responseBody));
  }

  // TODO R3: Atomic lock via DB unique constraint
  // ...
}`;

export default function LandingPage() {
  const reduce = useReducedMotion();

  // ── Typing / Live Code Effect ────────────────────────────────────────────
  // Slowly types out the comment line to give subtle liveliness to the editor
  const [typedCode, setTypedCode] = useState(SAMPLE_CODE);
  const [isTypingActive, setIsTypingActive] = useState(!reduce);

  useEffect(() => {
    if (reduce) {
      setTypedCode(SAMPLE_CODE);
      return;
    }

    let isMounted = true;
    let timeoutId: NodeJS.Timeout;

    // Subtle typing simulator that appends a code comment, pauses, resets
    const baseCode = SAMPLE_CODE;
    const additionalLines = [
      "\n  // Acquiring idempotency lock in PostgreSQL...",
      "\n  await db.idempotencyKey.create({ data: { key: idempotencyKey, status: 'IN_PROGRESS' } });",
    ];

    let lineIndex = 0;
    let charIndex = 0;

    const typeNextChar = () => {
      if (!isMounted) return;

      if (lineIndex < additionalLines.length) {
        const currentLine = additionalLines[lineIndex];
        if (charIndex < currentLine.length) {
          setTypedCode(baseCode + additionalLines.slice(0, lineIndex).join("") + currentLine.slice(0, charIndex + 1));
          charIndex++;
          timeoutId = setTimeout(typeNextChar, 45);
        } else {
          lineIndex++;
          charIndex = 0;
          timeoutId = setTimeout(typeNextChar, 600);
        }
      } else {
        // Pause when done, then reset
        timeoutId = setTimeout(() => {
          if (!isMounted) return;
          setTypedCode(baseCode);
          lineIndex = 0;
          charIndex = 0;
          timeoutId = setTimeout(typeNextChar, 1200);
        }, 4000);
      }
    };

    timeoutId = setTimeout(typeNextChar, 1500);

    return () => {
      isMounted = false;
      clearTimeout(timeoutId);
    };
  }, [reduce]);

  return (
    <div className="w-full min-h-[calc(100vh-56px)] flex flex-col justify-between overflow-x-hidden selection:bg-accent selection:text-white">
      {/* ── SECTION 1: HERO ── */}
      <section className="relative px-4 pt-16 pb-20 md:pt-24 md:pb-28 max-w-6xl mx-auto w-full text-center space-y-8">
        {/* Live Badge */}
        <motion.div
          initial={reduce ? false : { opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-border bg-surface text-xs font-mono text-text-secondary"
        >
          <span className="h-2 w-2 rounded-full bg-pass animate-pulse" />
          <span>4 real problem environments · Hidden test suites live in Docker</span>
        </motion.div>

        {/* Headline */}
        <div className="space-y-4 max-w-3xl mx-auto">
          <motion.h1
            initial={reduce ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, delay: 0.05 }}
            className="text-4xl sm:text-5xl md:text-6xl font-serif font-bold tracking-tight text-text leading-[1.12]"
          >
            The bug only shows up when someone&apos;s watching.
          </motion.h1>

          <motion.p
            initial={reduce ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, delay: 0.1 }}
            className="text-base sm:text-lg text-text-secondary max-w-2xl mx-auto leading-relaxed"
          >
            Fix real tickets. Graded by hidden tests in isolated containers.
            Realistic debugging assessments without trivia or artificial puzzles.
          </motion.p>
        </div>

        {/* CTAs */}
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, delay: 0.15 }}
          className="flex flex-wrap items-center justify-center gap-4 pt-2"
        >
          <Link
            href="/problems"
            className="px-6 py-3 rounded-lg text-sm font-semibold font-mono bg-accent text-white hover:bg-accent/90 transition-colors shadow-sm"
          >
            Try a free problem →
          </Link>
          <Link
            href="/recruiter/dashboard"
            className="px-6 py-3 rounded-lg text-sm font-semibold font-mono bg-surface-2 text-text border border-border hover:bg-surface hover:border-accent/40 transition-colors"
          >
            For recruiters
          </Link>
        </motion.div>

        {/* ── EMBEDDED WORKSPACE PREVIEW ── */}
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.25 }}
          className="pt-6 max-w-5xl mx-auto text-left"
        >
          <div className="rounded-xl border border-border bg-surface shadow-2xl overflow-hidden">
            {/* Window Chrome */}
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-surface-2/70 text-xs font-mono text-text-secondary">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-fail/60" />
                <span className="h-2.5 w-2.5 rounded-full bg-warning/60" />
                <span className="h-2.5 w-2.5 rounded-full bg-pass/60" />
                <span className="ml-2 text-[11px] text-text-secondary">PAY-482 — Checkout Idempotency</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-[11px] px-2 py-0.5 rounded bg-surface border border-border">Backend · Node.js</span>
                <span className="text-pass text-[11px]">Docker Ready</span>
              </div>
            </div>

            {/* Split layout: Ticket Details (left) & Live Monaco Code Editor (right) */}
            <div className="grid grid-cols-1 md:grid-cols-12 min-h-[380px]">
              {/* Ticket description & checks panel */}
              <div className="md:col-span-5 p-5 border-b md:border-b-0 md:border-r border-border bg-surface/50 space-y-4">
                <div className="space-y-1">
                  <span className="text-[10px] uppercase font-mono tracking-wider text-text-secondary font-semibold">
                    Customer Issue PAY-482
                  </span>
                  <h3 className="text-sm font-semibold text-text">
                    Checkout double-charges on client retry
                  </h3>
                  <p className="text-xs text-text-secondary leading-relaxed pt-1">
                    When network timeouts occur during checkout, client retries create duplicate PaymentIntents in Stripe. Implement atomic idempotency tracking.
                  </p>
                </div>

                <div className="pt-2 border-t border-border space-y-2">
                  <span className="text-[10px] uppercase font-mono tracking-wider text-text-secondary font-semibold">
                    Grading Pipeline (Visible & Hidden)
                  </span>
                  <div className="space-y-1.5 font-mono text-[11px]">
                    <div className="flex items-center gap-2 text-pass">
                      <span>✓</span>
                      <span>[V2:20] Returns 201 on initial checkout</span>
                    </div>
                    <div className="flex items-center gap-2 text-fail">
                      <span>✗</span>
                      <span>[V1:10] Returns 400 if Idempotency-Key header missing</span>
                    </div>
                    <div className="flex items-center gap-2 text-fail">
                      <span>✗</span>
                      <span>[V3:30] Returns 200 on duplicate replay; Stripe called once</span>
                    </div>
                    <div className="flex items-center gap-2 text-text-secondary/70">
                      <span>🔒</span>
                      <span>[H1-H3:40] Hidden concurrency & crash recovery tests</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Real Code Editor panel */}
              <div className="md:col-span-7 flex flex-col bg-[#1e1e1e] min-h-[380px]">
                <div className="flex items-center justify-between px-4 py-2 border-b border-white/10 bg-[#252526] text-[11px] font-mono text-white/80">
                  <span className="flex items-center gap-1.5">
                    <span className="text-amber-400">JS</span> src/charge.js
                  </span>
                  <span className="text-white/40 text-[10px]">Read-only preview</span>
                </div>
                <div className="flex-1 relative min-h-[340px]">
                  <CodeEditor
                    value={typedCode}
                    onChange={() => {}}
                    language="javascript"
                    filename="charge.js"
                    readOnly={true}
                    height="100%"
                  />
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </section>

      {/* ── SECTION 2: HOW IT WORKS ── */}
      <section className="border-t border-border bg-surface-2/40 py-20 px-4">
        <div className="max-w-5xl mx-auto space-y-12">
          <motion.div
            initial={reduce ? false : { opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.25 }}
            className="text-center space-y-2"
          >
            <h2 className="text-2xl sm:text-3xl font-serif font-bold text-text">
              How Heisenbug Works
            </h2>
            <p className="text-sm text-text-secondary max-w-xl mx-auto">
              Real problem environments, real tests, and reproducible developer evaluations.
            </p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              {
                step: "01",
                title: "Pick a Ticket",
                description:
                  "Start a session on realistic bugs: concurrency race conditions, payment idempotency, SQL n+1 performance, or XSS vulnerabilities.",
              },
              {
                step: "02",
                title: "Fix It in the Sandbox",
                description:
                  "Write code in the browser with full Monaco editor capabilities. Run visible unit tests on demand to verify your hypothesis.",
              },
              {
                step: "03",
                title: "Graded by Hidden Tests",
                description:
                  "Submit to an isolated Docker container with host-mounted hidden edge cases. Get deterministic scoring, diff inspection, and session replays.",
              },
            ].map((item, idx) => (
              <motion.div
                key={item.step}
                initial={reduce ? false : { opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{ duration: 0.22, delay: idx * 0.08 }}
                className="rounded-xl border border-border bg-surface p-6 space-y-3 relative overflow-hidden"
              >
                <span className="text-2xl font-mono font-bold text-accent/80">
                  {item.step}
                </span>
                <h3 className="text-base font-semibold text-text">{item.title}</h3>
                <p className="text-xs text-text-secondary leading-relaxed">
                  {item.description}
                </p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── SECTION 3: FEATURES (HONEST TO THE PLATFORM) ── */}
      <section className="py-20 px-4 max-w-6xl mx-auto w-full space-y-12">
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.25 }}
          className="text-center space-y-2"
        >
          <h2 className="text-2xl sm:text-3xl font-serif font-bold text-text">
            Engineered for Realistic Evaluation
          </h2>
          <p className="text-sm text-text-secondary max-w-xl mx-auto">
            Built from scratch to measure real engineering ability rather than algorithmic memorization.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {[
            {
              title: "Docker-Isolated Grading",
              badge: "Container Sandbox",
              description:
                "Hidden tests live securely on the host and mount into an isolated Docker runner container. Test execution has no network access and strict CPU/memory limits.",
            },
            {
              title: "4-Stage Problem Validation Pipeline",
              badge: "Quality Guarantee",
              description:
                "Every problem pack passes a strict deterministic pipeline before publishing: starter code fails, reference solution scores 100/100, 5-run consistency check passes, and bad patches are rejected.",
            },
            {
              title: "Candidate Session Replay & Process Analytics",
              badge: "Full Observability",
              description:
                "Recruiters don't just see a final score. Step through a candidate's complete timeline: keystroke save history, time to first test run, hint usage penalties, and unified code diffs.",
            },
            {
              title: "AI Mentor & Collaboration Scoring",
              badge: "Modern AI Pairing",
              description:
                "Practice mode includes an AI Socratic mentor. Recruiters receive separate collaboration signals observing whether candidate verified AI suggestions before submitting.",
            },
          ].map((feature, idx) => (
            <motion.div
              key={feature.title}
              initial={reduce ? false : { opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              whileHover={{ y: -2 }}
              transition={{ duration: 0.2, delay: idx * 0.05 }}
              className="rounded-xl border border-border bg-surface p-6 space-y-3 hover:border-accent/40 transition-colors shadow-sm"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold text-text">{feature.title}</h3>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded border border-border bg-surface-2 text-accent">
                  {feature.badge}
                </span>
              </div>
              <p className="text-xs text-text-secondary leading-relaxed">
                {feature.description}
              </p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ── SECTION 4: RECRUITER CTA BANNER ── */}
      <section className="px-4 pb-20 max-w-5xl mx-auto w-full">
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-60px" }}
          transition={{ duration: 0.25 }}
          className="rounded-2xl border border-border bg-gradient-to-br from-surface to-surface-2 p-8 sm:p-12 text-center space-y-6"
        >
          <div className="space-y-2 max-w-xl mx-auto">
            <h2 className="text-2xl sm:text-3xl font-serif font-bold text-text">
              Assess candidates on how they actually build software.
            </h2>
            <p className="text-xs sm:text-sm text-text-secondary leading-relaxed">
              Create timed assessments, send invitations, and inspect candidate problem-solving processes with real session event replays and Docker-backed grading.
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-4">
            <Link
              href="/recruiter/dashboard"
              className="px-6 py-3 rounded-lg text-xs font-mono font-semibold bg-accent text-white hover:bg-accent/90 transition-colors"
            >
              Open Recruiter Dashboard →
            </Link>
            <Link
              href="/problems"
              className="px-6 py-3 rounded-lg text-xs font-mono font-semibold bg-surface border border-border text-text hover:border-accent/40 transition-colors"
            >
              Browse Problems
            </Link>
          </div>
        </motion.div>
      </section>

      {/* 
        ========================================================================
        NOTE ON DELIBERATE OMISSIONS:
        4. COMPANY LOGOS / TRUSTED BY: Omitted because no external enterprise logos have been confirmed.
        5. TESTIMONIALS: Omitted to prevent fabricating quotes or customer personas.
        6. PRICING: Omitted because billing and payment processor (e.g., Stripe subscription)
           is not currently integrated in this repo.
        ========================================================================
      */}

      {/* ── SECTION 5: FOOTER ── */}
      <footer className="border-t border-border bg-surface px-4 py-8 text-xs font-mono text-text-secondary">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-accent inline-block" />
            <span className="font-serif font-semibold text-text text-sm">Heisenbug</span>
            <span>· Engineering Ticket Assessment Platform</span>
          </div>

          <div className="flex items-center gap-6">
            <Link href="/problems" className="hover:text-text transition-colors">
              Catalogue
            </Link>
            <Link href="/recruiter/dashboard" className="hover:text-text transition-colors">
              Recruiter
            </Link>
            <Link href="/login" className="hover:text-text transition-colors">
              Sign In
            </Link>
            <span className="text-text-secondary/50">v0.1.0</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
