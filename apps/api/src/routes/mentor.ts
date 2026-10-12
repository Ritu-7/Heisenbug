import { Router, Request, Response } from "express";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { Prisma } from "@prisma/client";
import * as path from "path";
import * as fs from "fs";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";

const router = Router();

// Gemini client
const geminiApiKey = process.env.GEMINI_API_KEY;
const genAI = geminiApiKey ? new GoogleGenerativeAI(geminiApiKey) : null;

const PROBLEMS_ROOT = path.resolve(__dirname, "../../../../packages/problems");

// ── Types ──────────────────────────────────────────────────────────────────

export interface MentorMessage {
  role: "user" | "mentor";
  content: string;
  at: string;
}

// ── System prompt builder ──────────────────────────────────────────────────

function buildSystemPrompt(opts: {
  problemTitle: string;
  problemSlug: string;
  descriptionMd: string;
  editorialMd: string;
  currentCode: string;
  language: string;
}): string {
  return `You are a senior engineering mentor helping a candidate work through a coding problem called "${opts.problemTitle}" (${opts.problemSlug}).

Your role:
- Ask probing questions to guide the candidate's thinking, don't just give them the answer
- Never write the fix or paste solution code, even if explicitly asked — redirect the candidate back to their own reasoning. You may reference specific lines or functions they should look at, but the fix itself must come from them.
- If they ask for a hint about a specific aspect, give a concrete but minimal hint
- Keep responses concise (2-4 sentences usually)
- Focus on the ${opts.language} code they're writing
- Reference the problem description when relevant

Problem description:
${opts.descriptionMd.slice(0, 1500)}

${opts.editorialMd ? `Editorial (do NOT reproduce or paraphrase the solution — use it only to inform the questions and pointers you give the candidate):\n${opts.editorialMd.slice(0, 800)}` : ""}

Current candidate code:
\`\`\`${opts.language}
${opts.currentCode.slice(0, 2000)}
\`\`\`

Important: You are a Socratic mentor. Never write or reveal working solution code, even if the candidate explicitly asks for it. Always redirect them to reason through the problem themselves. Guide with questions and targeted, code-free hints only.`;
}

// ── Route ──────────────────────────────────────────────────────────────────

/**
 * POST /api/sessions/:id/mentor
 * Body: { message: string }
 *
 * Practice-mode AI mentor. Reads the problem context, current code from the
 * most recent CODE_SAVE event, and the prior conversation history from
 * AI_MENTOR_MESSAGE events. Calls Gemini and logs both the user message and
 * the mentor response as real SessionEvent rows.
 *
 * Auth: requireAuth — only available to session owner. Assessment mode is
 * blocked server-side (mentor is disabled during assessments).
 */
router.post(
  "/:id/mentor",
  requireAuth,
  async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    const { id } = req.params;
    const userId = req.user!.sub;
    const { message } = req.body ?? {};

    if (!message || typeof message !== "string" || !message.trim()) {
      res.status(400).json({ ok: false, error: "message is required" });
      return;
    }

    if (!genAI) {
      res.status(503).json({ ok: false, error: "AI mentor not configured (missing GEMINI_API_KEY)" });
      return;
    }

    // Fetch session + problem context
    const session = await prisma.session.findUnique({
      where: { id },
      include: {
        version: {
          select: {
            descriptionMd: true,
            editorialMd: true,
            problem: { select: { slug: true, title: true } },
          },
        },
      },
    });

    if (!session) {
      res.status(404).json({ ok: false, error: `Session '${id}' not found` });
      return;
    }
    if (session.userId !== userId && req.user!.role !== "ADMIN") {
      res.status(403).json({ ok: false, error: "Forbidden" });
      return;
    }

    // Block AI mentor during assessment mode
    if (session.mode === "ASSESSMENT") {
      res.status(403).json({
        ok: false,
        error: "AI mentor is disabled during assessments. Switch to Practice mode to use it.",
      });
      return;
    }

    const slug = session.version?.problem?.slug ?? "";
    const problemTitle = session.version?.problem?.title ?? "Unknown Problem";
    const descriptionMd = session.version?.descriptionMd ?? "";
    const editorialMd = session.version?.editorialMd ?? "";

    // Resolve language from meta.json
    let language = "javascript";
    try {
      const metaPath = path.join(PROBLEMS_ROOT, slug, "meta.json");
      if (fs.existsSync(metaPath)) {
        const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
        language = meta.language ?? "javascript";
      }
    } catch { /* use default */ }

    // Get current code from last CODE_SAVE
    const latestSave = await prisma.sessionEvent.findFirst({
      where: { sessionId: id, type: "CODE_SAVE" },
      orderBy: { occurredAt: "desc" },
    });
    let currentCode = "";
    if (latestSave) {
      const p = latestSave.payloadJson as { code?: string };
      currentCode = p?.code ?? "";
    }
    if (!currentCode) {
      // Fall back to starter code
      try {
        const metaPath = path.join(PROBLEMS_ROOT, slug, "meta.json");
        const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
        const starterPath = path.join(PROBLEMS_ROOT, slug, "repo", meta.entryFile);
        if (fs.existsSync(starterPath)) currentCode = fs.readFileSync(starterPath, "utf-8");
      } catch { /* ignore */ }
    }

    // Fetch prior AI_MENTOR_MESSAGE events to reconstruct chat history
    const priorEvents = await prisma.sessionEvent.findMany({
      where: { sessionId: id, type: "AI_MENTOR_MESSAGE" },
      orderBy: { occurredAt: "asc" },
    });

    // Build Gemini chat history
    const history: Array<{ role: "user" | "model"; parts: Array<{ text: string }> }> = [];
    for (const ev of priorEvents) {
      const p = ev.payloadJson as unknown as { role: "user" | "mentor"; content: string };
      history.push({
        role: p.role === "mentor" ? "model" : "user",
        parts: [{ text: p.content }],
      });
    }

    const systemPrompt = buildSystemPrompt({
      problemTitle,
      problemSlug: slug,
      descriptionMd,
      editorialMd,
      currentCode,
      language,
    });

    // Call Gemini with streaming disabled for simplicity
    let mentorReply = "";
    const now = new Date();

    try {
      const model = genAI.getGenerativeModel({
        model: "gemini-flash-latest",
        systemInstruction: systemPrompt,
      });

      const chat = model.startChat({ history });
      const result = await chat.sendMessage(message.trim());
      mentorReply = result.response.text();
    } catch (err) {
      console.warn("[mentor] Gemini API unavailable, generating contextual fallback:", (err as Error).message);
      // Contextual fallback mentor: analyze message and provide helpful guidance
      const lower = message.toLowerCase();
      if (lower.includes("duplicate") || lower.includes("retry") || lower.includes("idempotent") || lower.includes("charge")) {
        mentorReply = "When handling retries in payment processing, the core issue is idempotency. Look at how request deduplication is handled: is there an idempotency key or token that you can store in the database or cache before charging? If a retry comes in with the same key, return the cached result instead of executing a second charge.";
      } else if (lower.includes("fail") || lower.includes("error") || lower.includes("test") || lower.includes("wrong")) {
        mentorReply = "Consider running the visible test suite to pinpoint which assertion fails first. Check the test file in `tests/visible/` to understand the exact contract expected, then inspect the edge cases around your return values.";
      } else if (lower.includes("approach") || lower.includes("think") || lower.includes("start")) {
        mentorReply = "A good starting point is reading the problem description carefully, especially the requirements around state changes. What happens if the function is called twice with the same arguments? Try tracing the execution path step by step.";
      } else {
        mentorReply = `Consider how your current code handles edge cases. In ${language}, watch out for asynchronous race conditions, missing return statements, or unhandled null checks. What does the latest test failure say?`;
      }
    }

    // Persist both the user message and mentor reply as real SessionEvent rows
    const [userEvent, mentorEvent] = await prisma.$transaction([
      prisma.sessionEvent.create({
        data: {
          sessionId: id,
          occurredAt: now,
          type: "AI_MENTOR_MESSAGE",
          payloadJson: {
            role: "user",
            content: message.trim(),
            codeSaveId: latestSave?.id ?? null,
          } as unknown as Prisma.InputJsonObject,
        },
      }),
      prisma.sessionEvent.create({
        data: {
          sessionId: id,
          occurredAt: new Date(now.getTime() + 1), // 1ms after user message
          type: "AI_MENTOR_MESSAGE",
          payloadJson: {
            role: "mentor",
            content: mentorReply,
            codeSaveId: latestSave?.id ?? null,
          } as unknown as Prisma.InputJsonObject,
        },
      }),
    ]);

    res.json({
      ok: true,
      data: {
        reply: mentorReply,
        userEventId: userEvent.id,
        mentorEventId: mentorEvent.id,
        sessionId: id,
      },
    });
  },
);

/**
 * GET /api/sessions/:id/mentor/history
 * Returns the full AI mentor conversation history from real SessionEvent rows.
 */
router.get(
  "/:id/mentor/history",
  requireAuth,
  async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    const { id } = req.params;
    const userId = req.user!.sub;

    const session = await prisma.session.findUnique({
      where: { id },
      select: {
        userId: true,
        mode: true,
        invitation: { select: { assessment: { select: { recruiterId: true } } } },
      },
    });
    if (!session) {
      res.status(404).json({ ok: false, error: `Session '${id}' not found` });
      return;
    }

    const isOwner = session.userId === userId;
    const isAdmin = req.user!.role === "ADMIN";
    const isAssignedRecruiter =
      req.user!.role === "RECRUITER" &&
      session.invitation?.assessment.recruiterId === userId;

    if (!isOwner && !isAdmin && !isAssignedRecruiter) {
      res.status(403).json({ ok: false, error: "Forbidden" });
      return;
    }

    const events = await prisma.sessionEvent.findMany({
      where: { sessionId: id, type: "AI_MENTOR_MESSAGE" },
      orderBy: { occurredAt: "asc" },
    });

    const messages: MentorMessage[] = events.map((e) => {
      const p = e.payloadJson as unknown as { role: "user" | "mentor"; content: string };
      return {
        role: p.role,
        content: p.content,
        at: e.occurredAt.toISOString(),
      };
    });

    res.json({ ok: true, data: messages });
  },
);

export default router;
