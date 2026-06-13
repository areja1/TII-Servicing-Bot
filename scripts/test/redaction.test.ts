/**
 * Privacy test: the traveler's home address must never reach the model.
 *
 * Sets COB_REDACT_STRINGS (the address in normal human form), then asserts that
 * the assembled CoB block — built from page text where pdf-parse spaced the
 * address differently — contains neither the street-number digits nor the ZIP.
 * Also confirms page-1 content survives so "summarize page 1 of my CoB" still
 * works (just without the address).
 *
 * Run: npm run test:redaction
 */

import assert from "node:assert/strict";

// A fictional address. The env var uses single spaces / human formatting; the
// page text below double-spaces and line-wraps it the way a PDF extractor might,
// to prove the whitespace-relaxed match still strips it.
const STREET_NUMBER = "742";
const ZIP = "97403";
process.env.COB_REDACT_STRINGS = `${STREET_NUMBER} Evergreen Terrace|Springfield, OR ${ZIP}`;

// redactPrivateDetails reads COB_REDACT_STRINGS lazily at call time, so it sees
// the value set above regardless of import timing.
const { buildCobBlock } = await import("@/lib/ai/prompt");
const { COB_FIELDS, redactPrivateDetails } = await import("@/config/cob-fields");

// Raw page text as pdf-parse might emit it (double-spaced, line-wrapped address).
const rawCobPageText = [
  "(p.1)",
  "Policyholder: Isaiah Lopez",
  `${STREET_NUMBER}  Evergreen   Terrace`,
  `Springfield,  OR   ${ZIP}`,
  "Trip Delay: $1,500",
  "",
  "(p.2)",
  "Schedule of Benefits",
].join("\n");

// Mirror the production read path: loadGroundingContext redacts the page text,
// then the route assembles it via buildCobBlock.
const block = buildCobBlock(redactPrivateDetails(rawCobPageText), COB_FIELDS);

assert.ok(
  !block.includes(STREET_NUMBER),
  `Assembled CoB block leaked the street number "${STREET_NUMBER}".`,
);
assert.ok(
  !block.includes(ZIP),
  `Assembled CoB block leaked the ZIP "${ZIP}".`,
);
assert.ok(
  block.includes("[redacted]"),
  "Expected a [redacted] marker where the address was.",
);
// Page-1 content (other than the address) must survive for page summaries.
assert.ok(block.includes("(p.1)"), "Page 1 marker was lost.");
assert.ok(
  block.includes("Policyholder: Isaiah Lopez"),
  "Non-address page-1 content was lost.",
);

console.log("PASS: home address redacted from assembled CoB block; page-1 content intact.");
