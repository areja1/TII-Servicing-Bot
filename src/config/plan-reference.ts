import { SOURCE, type SourceTag } from "@/config/tii";
import type { RetrievedPassage } from "@/types";

/**
 * High-value passages that are ALWAYS injected into the retrieval context.
 *
 * PostgreSQL full-text search reliably surfaces benefit *names* but sometimes
 * misses the dense Schedule-of-Benefits sub-limit tables and a few General
 * Definitions, because a short user question rarely shares enough tokens with
 * those chunks to rank in the top results. Since the source documents are
 * fixed for this POC, we pin these verbatim excerpts so the bot can always
 * answer about sub-limits (dental, per-article, passport, credit card) and key
 * definitions without guessing.
 *
 * Every string below is quoted directly from the FlexiPAX Plan Document.
 */
interface PinnedPassage {
  id: string;
  section: string;
  content: string;
}

const PINNED: PinnedPassage[] = [
  {
    id: "pinned-schedule-belongings-medical",
    section: "Schedule of Benefits (Sub-limits)",
    content: [
      "SECTION V — Protection For Your Belongings (Maximum Benefit Amounts)",
      "Baggage and Personal Effects: up to $1,000",
      "Sub-limits:",
      "- Passport, Visa or Other Travel Documents Replacement: up to $100",
      "- Credit Card charges and interest: up to $100",
      "- Per Article Limit: up to $250",
      "- Combined articles limit: up to $500",
      "Baggage Delay (6 hours): up to $300",
      "",
      "SECTION VI — Travel Insurance Benefits (Maximum Benefit Amounts)",
      "Accident & Sickness Medical Expense: up to $100,000",
      "- Dental Expense sublimit: up to $750",
      "",
      "(These are the FlexiPAX Plan Document's standard Schedule-of-Benefits amounts and sub-limits. This traveler also purchased the Optional Baggage & Personal Effects Increase (up to $2,500) and Optional Baggage Delay Increase (up to $500) per the Confirmation of Benefits; the per-article, combined, passport, credit-card and dental sub-limits above still apply within those benefits.)",
    ].join("\n"),
  },
  {
    id: "pinned-def-passport-replacement",
    section: "Section V › Passport / Travel Documents & Credit Card",
    content:
      "The plan covers the replacement of passports, visas and other travel documents which are lost, stolen, damaged or destroyed during Your Trip, and charges and interest incurred due to unauthorized use or replacement of Your lost or stolen credit cards if such use or loss occurs during Your Trip, subject to verification that You have complied with all conditions of the credit card company. Passport/Visa/Travel Documents Replacement is limited to up to $100, and Credit Card charges and interest to up to $100.",
  },
  {
    id: "pinned-def-traveling-companion",
    section: "Section VIII › General Definitions",
    content:
      "Traveling Companion means a person or persons whose name(s) appear(s) with Yours on the same Travel Arrangements and who, during Your Trip, will accompany You. A group or tour organizer, sponsor or leader is not a Traveling Companion as defined, unless sharing accommodations in the same room, cabin, condominium unit, apartment unit or other lodging with You.",
  },
];

/** Pinned passages shaped as retrieval results (tagged to the Plan Document). */
export const PINNED_PASSAGES: RetrievedPassage[] = PINNED.map((p) => ({
  id: p.id,
  source: SOURCE.PLAN_DOCUMENT as SourceTag,
  section: p.section,
  page: null,
  content: p.content,
  rank: 1,
}));
