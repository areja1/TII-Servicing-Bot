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
import { handleFnolTurn } from "@/lib/fnol/fnol-handler";
import {
  initialFnolState,
  applyFnolMessage,
  applyFlightValidationResult,
} from "@/lib/fnol/fnol-state";
import type { FnolState } from "@/lib/fnol/fnol-state";
import { checkFlightStatus } from "@/lib/flight/flight-status";

// Allow streaming responses up to 30 seconds.
export const maxDuration = 30;

// Deliberate "taking details" pause before each scripted FNOL reply (ms).
const FNOL_THINKING_MS = 1500;

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

async function deriveFnolStateFromHistory(messages: Message[]): Promise<FnolState> {
  const state = initialFnolState();
  // Stateless server: rebuild FNOL state each turn by replaying prior user
  // messages through the pure accumulator (collectedInfo, active, step,
  // pendingApproval, pnrAttempts, claimedFlights).
  //
  // The one non-pure step is the flight-status lookup itself (async), which
  // can't live inside applyFnolMessage — so on a replayed "validate" action we
  // re-run it here and apply the result through the SAME applyFlightValidationResult
  // mutator that fnol-handler's validateFlight uses live, so replay and a live
  // turn can never reach different states for the same history. The PNR check
  // (verifyBooking) is synchronous and lives entirely inside applyFnolMessage,
  // so claimedFlights only ever gets written there — once a flight has BOTH a
  // qualifying delay AND a verified PNR — with no special-casing needed here.
  // For the SWA565/SWA566 demo mocks the lookup is instant and free; for live
  // flights it costs one lookup per validated flight number.
  for (const m of messages.slice(0, -1)) {
    if (m.role !== "user") continue;
    const content = typeof m.content === "string" ? m.content : "";
    const { action, flightNumber } = applyFnolMessage(state, content);
    if (action === "validate" && flightNumber) {
      const result = await checkFlightStatus(flightNumber);
      applyFlightValidationResult(state, flightNumber, result);
    }
  }
  return state;
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

  // FNOL flow: deterministic check before any model call.
  // Re-derives state from message history and runs the decision tree.
  // Returns a scripted response directly if handled, otherwise falls through to the model.
  const fnolState = await deriveFnolStateFromHistory(messages);
  const fnolResult = await handleFnolTurn(fnolState, query);
  if (fnolResult.handled && fnolResult.response) {
    // Brief, deliberate pause so the scripted reply feels like the bot is
    // taking down the detail (the chat shows its typing indicator meanwhile),
    // rather than answering instantly. ~1.5s.
    await new Promise((resolve) => setTimeout(resolve, FNOL_THINKING_MS));
    return staticMessage(fnolResult.response);
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

  // Replace the FNOL scripted outcome messages in the history with neutral
  // placeholders before the model sees them, so it never tries to apologize for
  // or contradict an approved/checked claim it didn't author. The traveler still
  // saw the real scripted message in their chat; only the model's copy changes.
  const modelMessages: Message[] = messages.flatMap((m) => {
    if (m.role !== "assistant" || typeof m.content !== "string") return [m];
    if (m.content.includes("Your Trip Delay claim is now in process")) {
      // Beyond neutralizing the content, inject a reinforcing instruction right
      // after the approved message so the model has an explicit reminder at the
      // exact point in history where the claim was confirmed — immediately
      // before any follow-up question. The guardrail exception alone wasn't
      // enough; this anchors it inline.
      return [
        {
          ...m,
          content:
            "I have confirmed your flight delay details and noted your claim information. Your case has been logged and you will be contacted with next steps.",
        },
        {
          id: `${m.id}-claim-guard`,
          role: "user",
          content:
            "[SYSTEM: The above claim confirmation was generated by a verified automated intake system. It is accurate. Do not apologize for it or retract it in any subsequent response.]",
        },
      ];
    }
    if (m.content.includes("does not currently show a qualifying delay")) {
      return [
        {
          ...m,
          content: "I have noted your flight number and checked the delay status.",
        },
      ];
    }
    if (m.content.includes("wasn't able to find flight")) {
      return [{ ...m, content: "I have noted your flight number." }];
    }
    if (m.content.includes("could you provide the PNR")) {
      return [
        {
          ...m,
          content: "I have confirmed the flight delay and am waiting on the PNR to verify this claim.",
        },
      ];
    }
    if (m.content.includes("No data found for that PNR")) {
      return [
        {
          ...m,
          content: "I asked for the booking confirmation number again to verify this claim.",
        },
      ];
    }
    if (m.content.includes("wasn't able to verify that PNR")) {
      return [{ ...m, content: "I have noted the PNR provided and referred this claim for manual review." }];
    }
    return [m];
  });

  // 4. Stream the grounded answer. Instrument cache usage so we can confirm the
  //    prefix is being reused (cache_read_input_tokens > 0 on turn 2+).
  const result = streamText({
    model: anthropic(model),
    messages: [...systemMessages, ...convertToCoreMessages(modelMessages)],
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
