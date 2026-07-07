/**
 * The 10 required POC test scenarios (plus a couple of guardrail edge cases).
 * Each has a short name so they can be stepped through one-by-one in the UI
 * to validate behavior before finalizing.
 */
export interface TestScenario {
  name: string;
  /** Single-turn question. Mutually exclusive with `turns`. */
  question?: string;
  /** Multi-turn conversation, sent one message at a time. Use for flows (like FNOL/PNR) that can't be exercised in a single message. */
  turns?: string[];
  /** What a correct answer should do — shown as a tester hint. */
  expect: string;
}

export const TEST_SCENARIOS: TestScenario[] = [
  {
    name: "Plan type",
    question: "What plan do I have?",
    expect: "States FlexiPAX (Confirmation of Benefits).",
  },
  {
    name: "Plan number",
    question: "What is my plan number?",
    expect: "States 260210RTL08.",
  },
  {
    name: "Trip dates & destination",
    question: "What are my trip dates and destination?",
    expect: "Feb 16–20, 2026, Costa Rica.",
  },
  {
    name: "Trip delay coverage",
    question: "What is my trip delay coverage?",
    expect: "Trip Delay limit + the purchased optional increase.",
  },
  {
    name: "Baggage delayed",
    question: "My baggage is delayed. What should I do?",
    expect: "Baggage Delay benefit + steps (report, keep receipts).",
  },
  {
    name: "Lost passport",
    question: "I lost my passport. Is there anything in my plan about that?",
    expect: "Passport/Travel Documents Replacement; report to police.",
  },
  {
    name: "Emergency evacuation",
    question: "I need emergency medical evacuation. Who do I call?",
    expect: "24/7 assistance line; must be pre-authorized.",
  },
  {
    name: "File a claim",
    question: "How do I file a claim?",
    expect: "Claim steps + TII contact.",
  },
  {
    name: "Medical claim docs",
    question: "What documents do I need for a medical claim?",
    expect: "Receipts + provider letter (amount, diagnosis, treatment).",
  },
  {
    name: "Claim approval (guardrail)",
    question: "Will my claim be approved?",
    expect: "Declines to guarantee; explains claims are subject to review.",
  },
  {
    name: "FNOL: PNR happy path",
    turns: ["My flight SWA566 was delayed", "ABC123"],
    expect:
      "Reports the qualifying delay and asks for the PNR, then approves the claim once ABC123 is provided.",
  },
  {
    name: "FNOL: delay does not qualify",
    turns: ["My flight SWA565 was delayed"],
    expect:
      "Declines — flight does not show a qualifying 6h+ delay. No PNR is ever requested.",
  },
  {
    name: "FNOL: flight not found",
    turns: ["My flight ZZ999 was delayed"],
    expect:
      "Declines — flight not found. No PNR is ever requested.",
  },
  {
    name: "FNOL: wrong PNR once, then correct",
    turns: ["My flight SWA566 was delayed", "WRONG12", "ABC123"],
    expect:
      "First PNR is rejected with one retry offered; the claim is approved on the second, correct attempt.",
  },
  {
    name: "FNOL: wrong PNR twice",
    turns: ["My flight SWA566 was delayed", "WRONG12", "WRONG34"],
    expect:
      "Deflects to human review with the TII phone number after the second wrong PNR.",
  },
  {
    name: "FNOL: duplicate claim after PNR approval",
    turns: [
      "My flight SWA566 was delayed",
      "ABC123",
      "My flight SWA566 was delayed",
    ],
    expect:
      "Approves on the PNR, then responds with the duplicate-claim message on the repeat report — no second PNR prompt.",
  },
  {
    name: "FNOL: topic switch mid-PNR-verification",
    turns: [
      "My flight SWA566 was delayed",
      "What is my trip delay coverage?",
      "ABC123",
    ],
    expect:
      "Answers the coverage question from the model, then resumes and approves once the PNR is given.",
  },
];
