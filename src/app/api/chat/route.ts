import { anthropic } from "@ai-sdk/anthropic";
import { convertToCoreMessages, streamText, type Message } from "ai";
import { retrievePassages } from "@/lib/retrieval/search";
import { buildSystemPrompt, formatContext } from "@/lib/ai/prompt";
import { analyzeUserMessage, guardrailDirective } from "@/lib/ai/guardrails";
import { getClientIp, rateLimit } from "@/lib/rate-limit";

// Allow streaming responses up to 30 seconds.
export const maxDuration = 30;

const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6";

/**
 * Stream a single static message in the AI SDK data-stream format so the chat
 * client renders it like any normal assistant reply. Used for short-circuit
 * responses (empty input, rate limiting) that never hit the model.
 */
function staticMessage(text: string): Response {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(`0:${JSON.stringify(text)}\n`));
      controller.close();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "x-vercel-ai-data-stream": "v1",
    },
  });
}

export async function POST(req: Request) {
  // 0a. Rate limit per client IP to protect the public endpoint (and the
  //     Anthropic key) from spam. Rejected before any model call.
  const limit = rateLimit(getClientIp(req));
  if (!limit.allowed) {
    return staticMessage(
      `You've sent several messages in a short time. Please wait about ${limit.retryAfterSeconds} seconds and try again. For urgent help you can call TII at 1-800-243-3174, or the 24/7 assistance line at 1-800-494-9907.`,
    );
  }

  const { messages } = (await req.json()) as { messages: Message[] };

  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const query = lastUser?.content ?? "";

  // 0b. Empty / whitespace-only input: respond gracefully without calling the
  //     model (and without an empty turn).
  if (query.trim().length === 0) {
    return staticMessage(
      "It looks like your message was empty. Ask me anything about your travel insurance plan — for example your coverage and benefit amounts, what to do if something goes wrong on your trip, or how to file a claim.",
    );
  }

  // 1. Retrieve grounding passages (Confirmation of Benefits always included).
  const passages = await retrievePassages(query);
  const context = formatContext(passages);

  // 2. Deterministic guardrail signals reinforce the prompt for this turn.
  const signal = analyzeUserMessage(query);
  const directive = guardrailDirective(signal);

  const system = directive
    ? `${buildSystemPrompt(context)}\n\nTURN-SPECIFIC INSTRUCTION\n${directive}`
    : buildSystemPrompt(context);

  // 3. Stream the grounded answer.
  const result = streamText({
    model: anthropic(MODEL),
    system,
    messages: convertToCoreMessages(messages),
    temperature: 0.2,
  });

  return result.toDataStreamResponse();
}
