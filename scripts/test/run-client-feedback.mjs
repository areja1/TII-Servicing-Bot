/**
 * Smoke-test the client feedback scenarios locally.
 *   node scripts/test/run-client-feedback.mjs
 */
const URL = process.env.CHAT_URL ?? "http://localhost:3000/api/chat";

const QUESTIONS = [
  ["CF1", "What types of concierge services are available?"],
  ["CF1-short", "concierge"],
  ["CF2", "Why should I buy travel insurance?"],
  ["CF2-short", "why buy insurance?"],
  ["CF3", "Tell me about page 4 of my plan document."],
  ["CF3-short", "page 4"],
  ["CF4", "Can you summarize the different sections of my documents?"],
  ["CF4-short", "summary"],
  ["S1", "dental"],
  ["S2", "baggage"],
  ["S3", "assistance"],
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

for (const [id, q] of QUESTIONS) {
  const res = await fetch(URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: q }] }),
  });
  const answer = parseStream(await res.text());
  console.log(`\n\n========== ${id}: ${q} ==========\n${answer}`);
}
