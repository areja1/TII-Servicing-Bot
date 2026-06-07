/**
 * End-to-end tests for both source documents (CoB + Plan Document).
 *   node scripts/test/run-both-docs.mjs
 *   CHAT_URL=http://localhost:3000/api/chat node scripts/test/run-both-docs.mjs
 */
const URL = process.env.CHAT_URL ?? "http://localhost:3000/api/chat";

/** @type {Array<[string, string, RegExp[], RegExp[]]>} */
const TESTS = [
  // Plan Document — page tests
  [
    "PD-P1",
    "What is on page 1 of my plan document?",
    [/FlexiPAX/i, /travelinsured\.com/i, /800-494-9907/i, /855-752-8303/i],
    [/cannot help|don't have|not available/i],
  ],
  [
    "PD-P3",
    "What is on page 3 of my plan document?",
    [/Medical Upgrade|Baggage Delay|Baggage and Personal Effects|\$250,000|\$500,000/i],
    [/Worldwide Non-Insurance Assistance/i],
  ],
  [
    "PD-P4",
    "Tell me about page 4 of my plan document.",
    [/Non-Insurance Assistance|concierge|800-494-9907/i, /Medical or Legal Referral|Telemedicine/i],
    [/260210RTL08/i],
  ],
  // Confirmation of Benefits — page tests
  [
    "COB-P1",
    "What is on page 1 of my confirmation of benefits?",
    [/260210RTL08/i, /Isaiah Lopez|Costa Rica|February/i, /\$117|117\.00/i],
    [/Worldwide Non-Insurance/i],
  ],
  [
    "COB-P3",
    "What does page 3 of my confirmation of benefits cover?",
    [/claim/i, /documentation|document/i, /800-243-3174|243-3174/i],
    [/Medical Upgrade Bundle/i],
  ],
  // Both documents — same page number
  [
    "BOTH-P4",
    "Give me a summary of page 4",
    [/assistance|concierge|800-494-9907/i],
    [],
  ],
  // Non-page — full context regression
  [
    "REG-DELAY",
    "What is my trip delay coverage?",
    [/delay/i, /1,500|150\/day|\$150|\$1,500/i],
    [/cannot help|out of scope/i],
  ],
  [
    "REG-CONCIERGE",
    "What types of concierge services are available?",
    [/concierge|restaurant|hotel|destination profiles/i, /800-494-9907/i],
    [/cannot find|I don't have|not among the passages/i],
  ],
  [
    "REG-WHY",
    "Why should I buy travel insurance?",
    [/trip cancellation|medical|evacuation|baggage/i, /100%|\$100,000|\$500,000/i],
    [/out of scope|cannot help with that question/i],
  ],
  [
    "COB-SCHEDULE",
    "What benefits did I purchase and what are my coverage amounts?",
    [/cancellation|interruption|medical|evacuation|baggage|delay/i, /\$1,500|100%|\$100,000|\$500,000/i],
    [],
  ],
  [
    "PD-CLAIMS",
    "How do I file a claim according to the plan document?",
    [/claim/i, /document|notification|notify/i],
    [/cannot help/i],
  ],
];

function parseStream(text) {
  let out = "";
  for (const line of text.split("\n")) {
    if (line.startsWith("0:")) {
      try {
        out += JSON.parse(line.slice(2));
      } catch {
        /* ignore */
      }
    }
  }
  return out.trim();
}

function evaluate(id, question, mustMatch, mustNotMatch, answer) {
  const missing = mustMatch.filter((re) => !re.test(answer));
  const forbidden = mustNotMatch.filter((re) => re.test(answer));
  const pass =
    answer.length > 40 && missing.length === 0 && forbidden.length === 0;
  return { pass, missing, forbidden, answerLen: answer.length };
}

console.log(`Testing ${URL}\n`);
const results = [];

for (const [id, question, mustMatch, mustNotMatch] of TESTS) {
  process.stdout.write(`${id} ... `);
  try {
    const res = await fetch(URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: question }] }),
    });
    const raw = await res.text();
    const answer = parseStream(raw);
    const { pass, missing, forbidden, answerLen } = evaluate(
      id,
      question,
      mustMatch,
      mustNotMatch,
      answer,
    );
    results.push({ id, question, pass, missing, forbidden, answerLen, answer });
    console.log(pass ? "PASS" : "FAIL");
    if (!pass) {
      if (answerLen < 40) console.log("  (empty or very short response)");
      if (missing.length)
        console.log("  missing:", missing.map((r) => r.source).join(", "));
      if (forbidden.length)
        console.log("  forbidden matched:", forbidden.map((r) => r.source).join(", "));
    }
  } catch (err) {
    results.push({ id, question, pass: false, error: String(err) });
    console.log("ERROR", err.message);
  }
  await new Promise((r) => setTimeout(r, 1500));
}

const passed = results.filter((r) => r.pass).length;
console.log(`\n${"=".repeat(60)}`);
console.log(`RESULT: ${passed}/${results.length} passed`);
console.log("=".repeat(60));

for (const r of results.filter((x) => !x.pass)) {
  console.log(`\n--- FAIL: ${r.id} — ${r.question} ---`);
  if (r.error) console.log(r.error);
  else console.log(r.answer?.slice(0, 600) ?? "(no answer)");
}

process.exit(passed === results.length ? 0 : 1);
