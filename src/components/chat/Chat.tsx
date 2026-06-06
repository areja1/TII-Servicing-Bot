"use client";

import { useEffect, useRef } from "react";
import { useChat } from "@ai-sdk/react";
import { Markdown } from "./Markdown";
import { ChatBackground } from "./ChatBackground";

const SUGGESTED_QUESTIONS = [
  "What plan do I have?",
  "What are my trip dates and destination?",
  "What is my trip delay coverage?",
  "My baggage is delayed. What should I do?",
  "How do I file a claim?",
];

function TypingIndicator() {
  return (
    <div className="flex justify-start">
      <div className="flex items-center gap-1 rounded-2xl bg-white px-4 py-3 shadow-sm">
        <span className="typing-dot h-2 w-2 rounded-full bg-tii-blue/60" />
        <span
          className="typing-dot h-2 w-2 rounded-full bg-tii-blue/60"
          style={{ animationDelay: "0.15s" }}
        />
        <span
          className="typing-dot h-2 w-2 rounded-full bg-tii-blue/60"
          style={{ animationDelay: "0.3s" }}
        />
      </div>
    </div>
  );
}

export function Chat() {
  const { messages, input, handleInputChange, handleSubmit, isLoading, append } =
    useChat({ api: "/api/chat" });

  const scrollRef = useRef<HTMLDivElement>(null);

  // Smooth auto-scroll to the newest content as it streams in.
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  const lastMessage = messages[messages.length - 1];
  const awaitingFirstToken =
    isLoading && (!lastMessage || lastMessage.role === "user");

  // Ignore blank / whitespace-only submissions (e.g. pressing Enter on an
  // empty field) so we never send an empty turn.
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    if (!input.trim()) {
      e.preventDefault();
      return;
    }
    handleSubmit(e);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="relative flex-1 overflow-hidden">
        <ChatBackground />

        <div
          ref={scrollRef}
          className="relative h-full space-y-4 overflow-y-auto p-4"
        >
          {messages.length === 0 ? (
          <div className="mx-auto max-w-md space-y-4 pt-10 text-center">
            <p className="text-tii-navy/70">
              Ask about your plan, benefits, claims steps, required documents,
              or emergency assistance. Answers come from your plan documents.
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {SUGGESTED_QUESTIONS.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => append({ role: "user", content: q })}
                  className="rounded-full border border-tii-blue/30 bg-white px-3 py-1 text-sm text-tii-blue transition-all duration-150 hover:-translate-y-0.5 hover:bg-tii-blue/5 hover:shadow-sm active:translate-y-0"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m, idx) => {
            const isStreaming =
              isLoading &&
              m.role === "assistant" &&
              idx === messages.length - 1;
            return (
              <div
                key={m.id}
                className={
                  m.role === "user"
                    ? "flex justify-end animate-message-in"
                    : "flex justify-start animate-message-in"
                }
              >
                <div
                  className={
                    m.role === "user"
                      ? "max-w-[80%] rounded-2xl bg-tii-blue px-4 py-2 text-white"
                      : "max-w-[85%] rounded-2xl bg-white px-4 py-3 text-tii-navy shadow-sm"
                  }
                >
                  {m.role === "user" ? (
                    <p className="whitespace-pre-wrap">{m.content}</p>
                  ) : (
                    <div>
                      <Markdown content={m.content} />
                      {isStreaming && <span className="streaming-caret" />}
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}

          {awaitingFirstToken && <TypingIndicator />}
        </div>
      </div>

      <form
        onSubmit={onSubmit}
        className="border-t border-tii-navy/10 bg-white p-4"
      >
        <div className="mx-auto flex max-w-2xl gap-2">
          <input
            value={input}
            onChange={handleInputChange}
            placeholder="Ask about your travel insurance plan…"
            className="flex-1 rounded-full border border-tii-navy/20 px-4 py-2 outline-none transition-colors focus:border-tii-blue"
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="flex items-center gap-2 rounded-full bg-tii-navy px-5 py-2 font-medium text-white transition-opacity disabled:opacity-50"
          >
            {isLoading && (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
            )}
            {isLoading ? "Sending" : "Send"}
          </button>
        </div>
        <p className="mx-auto mt-2 max-w-2xl text-center text-xs text-tii-navy/50">
          Informational only. This assistant does not make claim decisions or
          provide medical or legal advice.
        </p>
      </form>
    </div>
  );
}
