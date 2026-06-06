/**
 * Re-run only the previously-Partial questions to confirm the fixes.
 *   node scripts/test/run-subset.mjs
 */
const URL = "http://localhost:3000/api/chat";

const QUESTIONS = [
  ["Q6", "I lost my passport. Is there anything in my plan about that?"],
  ["B8", "Is dental covered? What's the limit?"],
  ["B9", "What's my baggage per-article and combined limit?"],
  ["L7", "What is a traveling companion?"],
  ["UN3", "Can I extend my coverage - my trip got longer?"],
  ["UN4", "I want to add a traveler to my plan."],
  ["M3", "   "],
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
  console.log(`\n\n========== ${id}: ${q.trim() || "(blank)"} ==========\n${answer}`);
}
