/**
 * The 10 required POC test scenarios (plus a couple of guardrail edge cases).
 * Each has a short name so they can be stepped through one-by-one in the UI
 * to validate behavior before finalizing.
 */
export interface TestScenario {
  name: string;
  question: string;
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
];
