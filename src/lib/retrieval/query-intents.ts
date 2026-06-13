/**
 * Maps short or keyword-style user messages to document search terms.
 *
 * Full-text search struggles when the user sends one or two words ("concierge",
 * "dental") because those tokens rarely overlap enough with dense policy text.
 * policy text to rank in the top results. We expand the query and optionally
 * fetch chunks by keyword when an intent matches.
 */

export interface QueryIntentResult {
  /** Extra terms appended to the FTS query. */
  searchTerms: string[];
  /** Supabase ilike patterns (without the content.ilike. prefix). */
  contentPatterns: string[];
  /** Use a wider FTS result set for brief / ambiguous messages. */
  widenSearch: boolean;
}

interface TopicIntent {
  patterns: RegExp[];
  searchTerms: string[];
  contentPatterns: string[];
}

const TOPIC_INTENTS: TopicIntent[] = [
  {
    patterns: [
      /\bconcierge\b/i,
      /\brestaurant reserv/i,
      /\bhotel reserv/i,
      /\bbusiness concierge\b/i,
    ],
    searchTerms: [
      "CONCIERGE SERVICES BUSINESS CONCIERGE Worldwide Non-Insurance Assistance",
    ],
    contentPatterns: ["%CONCIERGE SERVICES%", "%BUSINESS CONCIERGE%"],
  },
  {
    patterns: [
      /\b(non[- ]?insurance|travel assistance|assistance service)\b/i,
      /\bassistance\b/i,
      /\bhelp line\b/i,
      /\b24\s*\/\s*7\b/i,
    ],
    searchTerms: [
      "24/7 Worldwide Non-Insurance Assistance Services travel assistance medical emergency",
    ],
    contentPatterns: [
      "%NON-INSURANCE ASSISTANCE%",
      "%Emergency Assistance%",
      "%800-494-9907%",
    ],
  },
  {
    patterns: [/\bidentity theft\b/i, /\bid theft\b/i],
    searchTerms: ["IDENTITY THEFT RESOLUTION SERVICES"],
    contentPatterns: ["%IDENTITY THEFT RESOLUTION%"],
  },
  {
    patterns: [/\bdental\b/i, /\bteeth\b/i, /\btooth\b/i],
    searchTerms: ["Dental Expense sublimit Accident Sickness Medical"],
    contentPatterns: ["%Dental Expense%", "%dental%"],
  },
  {
    patterns: [
      /\bmedical\b/i,
      /\bsickness\b/i,
      /\bdoctor\b/i,
      /\bhospital\b/i,
      /\baccident\s*&?\s*sickness\b/i,
    ],
    searchTerms: [
      "Accident Sickness Medical Expense Schedule of Benefits coverage",
    ],
    contentPatterns: ["%Accident & Sickness Medical%", "%Medical Expense%"],
  },
  {
    patterns: [/\bevacuat/i, /\bmedevac\b/i, /\brepatriat/i],
    searchTerms: ["Medical Evacuation Repatriation Remains evacuation"],
    contentPatterns: ["%Medical Evacuation%", "%Repatriation%"],
  },
  {
    patterns: [
      /\bbaggage\b/i,
      /\bluggage\b/i,
      /\bbags?\b/i,
      /\blost bag\b/i,
      /\bbelongings\b/i,
    ],
    searchTerms: [
      "Baggage Personal Effects Delay per article combined limit",
    ],
    contentPatterns: [
      "%Baggage and Personal Effects%",
      "%Baggage Delay%",
      "%Protection For Your Belongings%",
    ],
  },
  {
    patterns: [
      /\btrip cancel/i,
      /\bcancel(l)?ation\b/i,
      /\bcancel my trip\b/i,
      /\bcancelled\b/i,
    ],
    searchTerms: ["Trip Cancellation covered reasons non-refundable"],
    contentPatterns: ["%Trip Cancellation%"],
  },
  {
    patterns: [/\btrip interrupt/i, /\binterruption\b/i],
    searchTerms: ["Trip Interruption covered reasons"],
    contentPatterns: ["%Trip Interruption%"],
  },
  {
    patterns: [/\btrip delay\b/i, /\bdelayed flight\b/i, /\bdelay\b/i],
    searchTerms: ["Trip Delay covered delay hours expenses"],
    contentPatterns: ["%Trip Delay%"],
  },
  {
    patterns: [/\bmissed connection\b/i, /\bmissed tour\b/i, /\bmissed cruise\b/i],
    searchTerms: ["Missed Tour Cruise Connection"],
    contentPatterns: ["%Missed Tour%", "%Missed Connection%"],
  },
  {
    patterns: [/\bpassport\b/i, /\bvisa\b/i, /\btravel document/i],
    searchTerms: ["Passport Visa Travel Documents Replacement"],
    contentPatterns: ["%Passport%", "%Visa%", "%Travel Documents%"],
  },
  {
    patterns: [/\bcredit card\b/i],
    searchTerms: ["Credit Card charges interest unauthorized"],
    contentPatterns: ["%Credit Card%"],
  },
  {
    patterns: [/\bpre[- ]?existing\b/i, /\blook[- ]?back\b/i],
    searchTerms: ["Pre-Existing Condition exclusion waiver look-back"],
    contentPatterns: ["%Pre-Existing Condition%"],
  },
  {
    patterns: [/\btraveling companion\b/i, /\bcompanion\b/i],
    searchTerms: ["Traveling Companion definition"],
    contentPatterns: ["%Traveling Companion%"],
  },
  {
    patterns: [
      /\bclaim\b/i,
      /\bfile a claim\b/i,
      /\bhow (do|to) i (file|submit)\b/i,
    ],
    searchTerms: ["claim procedure notification documentation submit"],
    contentPatterns: ["%claim%", "%Claim Procedures%"],
  },
  {
    patterns: [
      /\bwhy\b.*\b(travel insurance|buy)\b/i,
      /\bvalue of travel insurance\b/i,
      /\bwhy should i\b/i,
      /\bworth it\b/i,
    ],
    searchTerms: [
      "Schedule of Benefits trip cancellation medical evacuation baggage delay",
    ],
    contentPatterns: [],
  },
  {
    patterns: [/\b(summarize|summary|overview)\b/i, /\bwhat('s| is) (in| covered)\b/i],
    searchTerms: [
      "Schedule of Benefits SECTION assistance services concierge coverage",
    ],
    contentPatterns: ["%Schedule of Benefits%", "%NON-INSURANCE ASSISTANCE%"],
  },
  {
    patterns: [/\brental car\b/i, /\bcar rental\b/i],
    searchTerms: ["Rental Car Damage Theft Coverage optional"],
    contentPatterns: ["%Rental Car%"],
  },
  {
    patterns: [/\bpolitical\b/i, /\bnatural disaster\b/i, /\bsecurity evacuat/i],
    searchTerms: ["Political Security Natural Disaster Evacuation"],
    contentPatterns: ["%Political%", "%Natural Disaster%", "%Evacuation%"],
  },
  {
    patterns: [
      /\baccidental death\b/i,
      /\bad&d\b/i,
      /\bdismemberment\b/i,
    ],
    searchTerms: ["Accidental Death Dismemberment AD&D"],
    contentPatterns: ["%Accidental Death%", "%Dismemberment%"],
  },
  {
    patterns: [
      /\bphone\b/i,
      /\bcontact\b/i,
      /\bnumber\b/i,
      /\bcall\b/i,
      /\b800[- ]?494/i,
      /\b800[- ]?243/i,
    ],
    searchTerms: ["800-494-9907 800-243-3174 assistance claims contact"],
    contentPatterns: ["%800-494-9907%", "%800-243-3174%"],
  },
  {
    patterns: [/\bcfAR\b/i, /\bcancel for any reason\b/i, /\boptional upgrade\b/i],
    searchTerms: ["Cancel For Any Reason optional upgrade bundle"],
    contentPatterns: ["%Cancel For Any Reason%", "%Optional%"],
  },
  {
    patterns: [/\bcoverage\b/i, /\bbenefits?\b/i, /\bwhat do i have\b/i],
    searchTerms: ["Schedule of Benefits Maximum Benefit Amount coverage"],
    contentPatterns: ["%Schedule of Benefits%", "%Maximum Benefit%"],
  },
];

const STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "my",
  "is",
  "are",
  "do",
  "i",
  "me",
  "what",
  "how",
  "about",
  "tell",
  "show",
  "please",
  "can",
  "you",
]);

/** Brief messages (≤4 words or ≤35 chars) get wider FTS and keyword heuristics. */
export function isShortQuery(query: string): boolean {
  const trimmed = query.trim();
  const words = trimmed.split(/\s+/).filter(Boolean);
  return words.length <= 4 || trimmed.length <= 35;
}

function significantWords(query: string): string[] {
  return query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/[^a-z0-9-]/g, ""))
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
}

/**
 * Resolve topic intents for a user message. Merges regex-based topic maps with
 * single-word heuristics for very short queries.
 */
export function resolveQueryIntents(query: string): QueryIntentResult {
  const searchTerms = new Set<string>();
  const contentPatterns = new Set<string>();
  const trimmed = query.trim();

  for (const intent of TOPIC_INTENTS) {
    if (intent.patterns.some((p) => p.test(trimmed))) {
      for (const term of intent.searchTerms) searchTerms.add(term);
      for (const pattern of intent.contentPatterns) contentPatterns.add(pattern);
    }
  }

  // For short queries, re-check each significant word against topic patterns
  // (e.g. "concierge", "dental", "baggage" as standalone messages).
  if (isShortQuery(trimmed)) {
    for (const word of significantWords(trimmed)) {
      const wordRe = new RegExp(`\\b${word}\\b`, "i");
      for (const intent of TOPIC_INTENTS) {
        if (
          intent.patterns.some((p) => p.test(word) || p.test(trimmed)) ||
          intent.searchTerms.some((t) => wordRe.test(t))
        ) {
          for (const term of intent.searchTerms) searchTerms.add(term);
          for (const pattern of intent.contentPatterns)
            contentPatterns.add(pattern);
        }
      }
    }
  }

  return {
    searchTerms: [...searchTerms],
    contentPatterns: [...contentPatterns],
    widenSearch: isShortQuery(trimmed),
  };
}

/** Build the FTS query string with intent-based expansion. */
export function expandQueryForRetrieval(query: string): string {
  const { searchTerms } = resolveQueryIntents(query);
  return searchTerms.length ? `${query} ${searchTerms.join(" ")}` : query;
}

/** Prompt hint when the user sends a brief keyword-style message. */
export function shortQueryDirective(query: string): string {
  if (!isShortQuery(query)) return "";
  return (
    "The traveler sent a brief message. Treat it as a topic keyword about their FlexiPAX plan or Confirmation of Benefits. " +
    "Answer directly from the SOURCE DOCUMENTS below — do not ask them to rephrase unless the message is empty or completely unrelated to travel insurance."
  );
}
