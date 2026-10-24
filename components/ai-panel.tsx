"use client";

import { useState } from "react";

type Role = "ADMIN" | "HR" | "EMPLOYEE";
type Msg = { role: "user" | "assistant"; content: string };

const SUGGESTIONS: Record<Role, string[]> = {
  ADMIN: [
    "How many active employees are in Engineering?",
    "Who came late most often this month?",
    "What is this month's attendance rate?",
  ],
  HR: [
    "How many active employees are in Engineering?",
    "Who is on leave today?",
    "Who came late most often this month?",
  ],
  EMPLOYEE: [
    "How many sick leaves do I have left this year?",
    "I need next Monday and Tuesday off for my sister's wedding",
  ],
};

type ChatResponse = {
  answer?: string;
  label?: string;
  degraded?: boolean;
  error?: { message?: string };
};

export function AiPanel({ role = "EMPLOYEE" }: { role?: Role }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  async function send(text = input) {
    const content = text.trim();
    if (!content || busy) return;
    const next: Msg[] = [...msgs, { role: "user", content }];
    setMsgs(next);
    setInput("");
    setBusy(true);
    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next }),
      });
      const data: ChatResponse = await res.json();
      setMsgs([
        ...next,
        {
          role: "assistant",
          content: data.answer ?? data.error?.message ?? "Error",
        },
      ]);
    } catch {
      setMsgs([
        ...next,
        {
          role: "assistant",
          content:
            "The assistant is unreachable. Check your connection and try again.",
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full flex-col gap-2 p-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          Assistant
        </h2>
        <span className="text-[10px] text-zinc-500">AI-generated answers</span>
      </div>

      <div className="flex-1 space-y-2 overflow-auto" aria-live="polite">
        {msgs.length === 0 && (
          <div className="space-y-1.5">
            <p className="text-xs text-zinc-500">Ask about your data. Try:</p>
            {SUGGESTIONS[role].map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => send(s)}
                className="block w-full rounded-md border-zinc-200 px-2 py-1.5 text-left text-xs text-zinc-600 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-900"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {msgs.map((m, i) => (
          <div key={i} className={m.role === "user" ? "text-right" : ""}>
            <div
              className={`inline-block max-w-[90%] rounded-lg px-3 py-2 text-sm ${
                m.role === "user"
                  ? "bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900"
                  : "bg-zinc-100 text-zinc-800 dark:bg-zinc-900 dark:text-zinc-200"
              }`}
            >
              {m.content}
            </div>
            {m.role === "assistant" && (
              <div className="text-[10px] text-zinc-500 dark:text-zinc-400">
                AI-generated
              </div>
            )}
          </div>
        ))}
        {busy && <div className="text-sm text-zinc-500">Thinking…</div>}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        className="flex gap-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          className="min-w-0 flex-1 rounded border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-950"
          placeholder="Ask about your data…"
          aria-label="Ask the assistant"
        />
        <button
          type="submit"
          className="rounded bg-zinc-900 px-3 text-sm text-white disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900"
          disabled={busy}
        >
          Send
        </button>
      </form>
    </div>
  );
}
