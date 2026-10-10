"use client";

import { useState, useRef, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";
import { getAuthToken } from "@/lib/api";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

// ── Types ──────────────────────────────────────────────────────────────────

interface MentorMessage {
  role: "user" | "mentor";
  content: string;
  at: string;
}

// ── API helpers ────────────────────────────────────────────────────────────

async function fetchMentorHistory(sessionId: string): Promise<MentorMessage[]> {
  const res = await fetch(`${API_BASE}/api/sessions/${sessionId}/mentor/history`, {
    headers: { Authorization: `Bearer ${getAuthToken()}` },
  });
  if (!res.ok) throw new Error("Failed to load mentor history");
  const data = await res.json();
  return data.data ?? [];
}

async function sendMentorMessage(
  sessionId: string,
  message: string,
): Promise<{ reply: string }> {
  const res = await fetch(`${API_BASE}/api/sessions/${sessionId}/mentor`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getAuthToken()}`,
    },
    body: JSON.stringify({ message }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error ?? "Mentor unavailable");
  return data.data;
}

// ── Message bubble ─────────────────────────────────────────────────────────

function MessageBubble({ msg, index }: { msg: MentorMessage; index: number }) {
  const reduce = useReducedMotion();
  const isUser = msg.role === "user";

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, delay: index * 0.03 }}
      className={cn(
        "flex gap-2",
        isUser ? "justify-end" : "justify-start",
      )}
    >
      {!isUser && (
        <div className="shrink-0 h-6 w-6 rounded-full bg-accent flex items-center justify-center text-[10px] text-white font-bold mt-0.5">
          AI
        </div>
      )}
      <div
        className={cn(
          "max-w-[85%] rounded-xl px-3 py-2 text-xs leading-relaxed",
          isUser
            ? "bg-accent text-white rounded-tr-sm"
            : "bg-surface-2 border border-border text-text rounded-tl-sm",
        )}
      >
        {msg.content.split("\n").map((line, i) => (
          <span key={i}>
            {line}
            {i < msg.content.split("\n").length - 1 && <br />}
          </span>
        ))}
        <div
          className={cn(
            "text-[9px] mt-1 opacity-60",
            isUser ? "text-white/70 text-right" : "text-text-secondary",
          )}
        >
          {new Date(msg.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </div>
      </div>
    </motion.div>
  );
}

// ── Main mentor panel ──────────────────────────────────────────────────────

interface AIMentorPanelProps {
  sessionId: string;
  isAssessment: boolean;
  isOpen: boolean;
  onClose: () => void;
}

export function AIMentorPanel({
  sessionId,
  isAssessment,
  isOpen,
  onClose,
}: AIMentorPanelProps) {
  const reduce = useReducedMotion();
  const [input, setInput] = useState("");
  const [localMessages, setLocalMessages] = useState<MentorMessage[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Load prior conversation history from real AI_MENTOR_MESSAGE events
  const { data: history = [], isLoading: historyLoading } = useQuery({
    queryKey: ["mentor-history", sessionId],
    queryFn: () => fetchMentorHistory(sessionId),
    enabled: !!sessionId && isOpen,
    staleTime: 30_000,
  });

  // Merge DB history with local (optimistic) messages
  const allMessages: MentorMessage[] = [
    ...history,
    ...localMessages.filter(
      (lm) => !history.some((h) => h.at === lm.at && h.role === lm.role),
    ),
  ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [allMessages.length]);

  // Focus input when panel opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  const sendMutation = useMutation({
    mutationFn: (msg: string) => sendMentorMessage(sessionId, msg),
    onMutate: (msg: string) => {
      const now = new Date().toISOString();
      // Optimistically add user message
      setLocalMessages((prev) => [
        ...prev,
        { role: "user", content: msg, at: now },
      ]);
      setInput("");
    },
    onSuccess: (data) => {
      const now = new Date().toISOString();
      setLocalMessages((prev) => [
        ...prev,
        { role: "mentor", content: data.reply, at: now },
      ]);
    },
    onError: (err) => {
      setLocalMessages((prev) => [
        ...prev,
        {
          role: "mentor",
          content: `Sorry, I encountered an error: ${(err as Error).message}. Please try again.`,
          at: new Date().toISOString(),
        },
      ]);
    },
  });

  const handleSend = () => {
    if (!input.trim() || sendMutation.isPending) return;
    sendMutation.mutate(input.trim());
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={reduce ? false : { opacity: 0, x: 20, scale: 0.97 }}
          animate={{ opacity: 1, x: 0, scale: 1 }}
          exit={{ opacity: 0, x: 20, scale: 0.97 }}
          transition={{ duration: 0.2 }}
          className="flex flex-col w-80 border-l border-border bg-surface h-full shrink-0"
          data-testid="ai-mentor-panel"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2.5 border-b border-border bg-surface-2 shrink-0">
            <div className="flex items-center gap-2">
              <div className="h-5 w-5 rounded-full bg-accent flex items-center justify-center text-[9px] text-white font-bold">
                AI
              </div>
              <div>
                <span className="text-xs font-semibold text-text">AI Mentor</span>
                <span className="text-[10px] text-text-secondary ml-1.5 font-mono">
                  Practice mode
                </span>
              </div>
            </div>
            <button
              onClick={onClose}
              className="text-text-secondary hover:text-text transition-colors p-1 rounded"
              aria-label="Close mentor"
            >
              ✕
            </button>
          </div>

          {/* Assessment mode guard */}
          {isAssessment ? (
            <div className="flex-1 flex flex-col items-center justify-center p-6 text-center space-y-3">
              <div className="h-10 w-10 rounded-full bg-surface-2 border border-border flex items-center justify-center text-lg">
                🔒
              </div>
              <p className="text-sm font-semibold text-text">Locked in Assessment Mode</p>
              <p className="text-xs text-text-secondary">
                AI mentor is disabled during timed assessments. Use it in Practice mode.
              </p>
            </div>
          ) : (
            <>
              {/* Messages area */}
              <div className="flex-1 overflow-y-auto p-3 space-y-3">
                {historyLoading ? (
                  <div className="flex items-center gap-2 text-xs text-text-secondary font-mono animate-pulse">
                    <span className="h-4 w-4 rounded-full bg-surface-2" />
                    Loading conversation history...
                  </div>
                ) : allMessages.length === 0 ? (
                  <div className="py-8 text-center space-y-2">
                    <div className="text-2xl">🤖</div>
                    <p className="text-xs font-semibold text-text">AI Mentor</p>
                    <p className="text-[11px] text-text-secondary leading-relaxed max-w-xs mx-auto">
                      Ask me about the problem, your approach, or specific code issues.
                      I'll guide you without giving away the answer.
                    </p>
                    <div className="space-y-1 pt-2">
                      {[
                        "Why is my solution failing?",
                        "What should I think about for idempotency?",
                        "Review my current approach",
                      ].map((prompt) => (
                        <button
                          key={prompt}
                          onClick={() => {
                            setInput(prompt);
                            inputRef.current?.focus();
                          }}
                          className="block w-full text-left text-[11px] font-mono px-2.5 py-1.5 rounded-lg border border-border hover:border-accent/40 hover:bg-accent-soft/20 text-text-secondary hover:text-accent transition-colors"
                        >
                          {prompt}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <>
                    {allMessages.map((msg, i) => (
                      <MessageBubble key={`${msg.role}-${msg.at}`} msg={msg} index={i} />
                    ))}
                    {sendMutation.isPending && (
                      <div className="flex gap-2 justify-start">
                        <div className="shrink-0 h-6 w-6 rounded-full bg-accent flex items-center justify-center text-[10px] text-white font-bold mt-0.5">
                          AI
                        </div>
                        <div className="bg-surface-2 border border-border rounded-xl rounded-tl-sm px-3 py-2">
                          <div className="flex items-center gap-1.5">
                            {[0, 1, 2].map((i) => (
                              <span
                                key={i}
                                className="h-1.5 w-1.5 rounded-full bg-text-secondary/60 animate-bounce"
                                style={{ animationDelay: `${i * 0.15}s` }}
                              />
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </>
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Input area */}
              <div className="border-t border-border p-2.5 shrink-0">
                <div className="flex gap-2 items-end">
                  <textarea
                    ref={inputRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Ask the mentor… (Enter to send)"
                    rows={2}
                    className="flex-1 resize-none rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs font-mono text-text placeholder:text-text-secondary focus:outline-none focus:border-accent/60 focus:ring-1 focus:ring-accent/20 transition-colors"
                    disabled={sendMutation.isPending}
                  />
                  <button
                    onClick={handleSend}
                    disabled={!input.trim() || sendMutation.isPending}
                    className={cn(
                      "px-3 py-2 rounded-lg text-xs font-semibold transition-colors shrink-0",
                      "bg-accent text-white hover:bg-accent/90",
                      "disabled:opacity-40 disabled:cursor-not-allowed",
                    )}
                  >
                    →
                  </button>
                </div>
                <p className="text-[10px] text-text-secondary mt-1.5 font-mono">
                  All messages logged as session events · <kbd className="font-sans">Shift+Enter</kbd> for newline
                </p>
              </div>
            </>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
