import { anthropic } from "@ai-sdk/anthropic";
import {
  convertToCoreMessages,
  streamText,
  type CoreMessage,
  type Message,
} from "ai";
import { loadGroundingContext, pageQueryDirective } from "@/lib/retrieval/search";
import { buildCachedCore, buildCobBlock } from "@/lib/ai/prompt";
import {
  analyzeUserMessage,
  guardrailDirective,
  type GuardrailSignal,
} from "@/lib/ai/guardrails";
import { getClientIp, rateLimit } from "@/lib/rate-limit";

// Allow streaming responses up to 30 seconds.
export const maxDuration = 30;

const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6";
// Optional cheaper model for simple lookups. See selectModel().
const HAIKU_MODEL = process.env.ANTHROPIC_MODEL_HAIKU ?? "claude-haiku-4-5";

/**
 * Optional model routing (default OFF). When ENABLE_HAIKU_ROUTING=true, simple,
 * non-safety-critical lookups can be answered by the cheaper Haiku model.
 *
 * Kept off by default because (a) the prompt cache is per-model — switching
 * models mid-conversation discards the cached prefix — and (b) per the plan,
 * Haiku must be validated against all 95 test scenarios (especially the
 * prompt-injection set) before it is trusted on any guardrail-critical path.
 * Emergency / claim-outcome turns always stay on the primary model.
 */
function selectModel(signal: GuardrailSignal): string {
  if (process.env.ENABLE_HAIKU_ROUTING !== "true") return MODEL;
  if (signal.isEmergency || signal.asksClaimOutcome) return MODEL;
  return HAIKU_MODEL;
}

/** Read a numeric cache stat out of the provider metadata, defaulting to 0. */
function num(value: unknown): number {
  return typeof value === "number" ? value : 0;
}

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

  // 1. Load the grounding context: shared plan full text + this traveler's CoB.
  //    For the single-plan POC we use the default plan number. In a multi-tenant
  //    deployment, derive plan_number strictly from the authenticated user so
  //    one traveler can never receive another's CoB.
  const { planText, cobPageText, cobFields, scope } = await loadGroundingContext();

  // 2. Guardrail layer 1 (deterministic input check) + per-turn directive.
  const signal = analyzeUserMessage(query);
  const directive = [
    guardrailDirective(signal),
    pageQueryDirective(query, scope),
  ]
    .filter(Boolean)
    .join(" ");

  const model = selectModel(signal);

  // 3. Build the prompt as cached prefix blocks + a volatile per-turn directive.
  //    Order is load-bearing for caching: longer-TTL, plan-shared block first
  //    (core rules + plan doc), then the per-traveler CoB, then — AFTER both
  //    cache breakpoints — the uncached turn directive.
  const systemMessages: CoreMessage[] = [
    {
      role: "system",
      content: buildCachedCore(planText),
      providerOptions: {
        anthropic: { cacheControl: { type: "ephemeral", ttl: "1h" } },
      },
    },
    {
      role: "system",
      content: buildCobBlock(cobPageText, cobFields),
      providerOptions: {
        anthropic: { cacheControl: { type: "ephemeral" } },
      },
    },
  ];
  if (directive) {
    // Uncached, every turn, at full system authority — placed after both
    // cache breakpoints so it never invalidates the cached prefix.
    systemMessages.push({
      role: "system",
      content: `TURN-SPECIFIC INSTRUCTION\n${directive}`,
    });
  }

  // 4. Stream the grounded answer. Instrument cache usage so we can confirm the
  //    prefix is being reused (cache_read_input_tokens > 0 on turn 2+).
  const result = streamText({
    model: anthropic(model),
    messages: [...systemMessages, ...convertToCoreMessages(messages)],
    temperature: 0.2,
    onFinish({ usage, providerMetadata }) {
      const anth = providerMetadata?.anthropic;
      const cacheRead = num(anth?.cacheReadInputTokens);
      const cacheCreation = num(anth?.cacheCreationInputTokens);
      console.log(
        JSON.stringify({
          event: "chat_usage",
          model,
          inputTokens: usage?.promptTokens ?? 0,
          outputTokens: usage?.completionTokens ?? 0,
          cacheReadInputTokens: cacheRead,
          cacheCreationInputTokens: cacheCreation,
          turns: messages.length,
        }),
      );
    },
  });

  return result.toDataStreamResponse();
}
