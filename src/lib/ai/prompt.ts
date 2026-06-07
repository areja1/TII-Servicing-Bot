import { SOURCE, SOURCE_LABELS } from "@/config/tii";
import { buildCoreInstructions } from "@/lib/ai/grounding-rules";
import type { RetrievedPassage } from "@/types";

/**
 * Formats the full Confirmation of Benefits and FlexiPAX Plan Document for the
 * model context, grouped by source document.
 */
export function formatContext(passages: RetrievedPassage[]): string {
  if (passages.length === 0) {
    return "(No document passages were loaded.)";
  }

  const formatSection = (title: string, items: RetrievedPassage[]) => {
    if (items.length === 0) return "";
    const body = items
      .map((p, i) => {
        const section = p.section ? ` › ${p.section}` : "";
        const page = p.page ? ` (p.${p.page})` : "";
        return `[${i + 1}]${section}${page}\n${p.content}`;
      })
      .join("\n\n");
    return `### ${title}\n\n${body}`;
  };

  const sortByPage = (items: RetrievedPassage[]) =>
    [...items].sort(
      (a, b) => (a.page ?? 0) - (b.page ?? 0) || a.content.localeCompare(b.content),
    );

  const cob = sortByPage(passages.filter((p) => p.source === SOURCE.CONFIRMATION_OF_BENEFITS));
  const plan = sortByPage(passages.filter((p) => p.source === SOURCE.PLAN_DOCUMENT));

  return [
    formatSection(SOURCE_LABELS[SOURCE.CONFIRMATION_OF_BENEFITS], cob),
    formatSection(SOURCE_LABELS[SOURCE.PLAN_DOCUMENT], plan),
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function buildSystemPrompt(context: string, scope: string): string {
  return `${buildCoreInstructions()}

DOCUMENT TEXT (${scope})

${context}`;
}
