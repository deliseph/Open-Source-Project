import type { Hit, Lead, Query } from "./types.js";

/**
 * Turning raw hits into a short list worth acting on.
 *
 * A search returns dozens of things. Almost all of them are threads where
 * replying would be an intrusion. The scoring below is tuned to be *harsh* —
 * it is far better to surface three genuine leads than thirty maybes, because
 * a person working through a long list stops reading threads properly and
 * starts pasting, which is exactly the failure mode to avoid.
 */

const STOPWORDS = new Set(["how", "the", "a", "an", "to", "my", "is", "in", "of", "and", "for", "do", "i"]);

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

/**
 * How well a hit matches the search terms, 0–1.
 *
 * Title matches count double: someone whose *title* is the question you answer
 * is asking it, while someone who mentioned it in passing mid-thread is not.
 */
export function score(hit: Hit, terms: string[]): number {
  const title = new Set(words(hit.title));
  const body = new Set(words(hit.text ?? ""));

  let best = 0;
  for (const term of terms) {
    const needed = words(term);
    if (needed.length === 0) continue;

    let inTitle = 0;
    let inBody = 0;
    for (const word of needed) {
      if (title.has(word)) inTitle++;
      else if (body.has(word)) inBody++;
    }
    best = Math.max(best, (inTitle * 2 + inBody) / (needed.length * 2));
  }
  return Math.min(1, best);
}

/** Threads that exist to list tools are not places to add your tool. */
const PROMO = /\b(best \d+|top \d+|roundup|alternatives to|megathread|weekly thread)\b/i;

/**
 * Combines match quality with signals about whether a reply would land.
 *
 * An unanswered question is the ideal lead. A 400-comment thread is not — your
 * reply will be invisible, and posting into it reads as chasing attention.
 */
export function relevance(hit: Hit, terms: string[]): number {
  let value = score(hit, terms);
  if (value === 0) return 0;

  // Every modifier is a penalty, never a boost. Boosting and then clamping to
  // 1 would silently flatten the ranking for the strongest matches — which are
  // precisely the ones that need to be ordered correctly.
  if (PROMO.test(hit.title)) value *= 0.3;

  const ageDays = (Date.now() - hit.createdAt.getTime()) / 86_400_000;
  if (ageDays > 730) value *= 0.75; // still findable in search, just colder

  const comments = hit.comments ?? 0;
  if (comments > 150) value *= 0.5; // you will not be seen
  else if (comments > 0) value *= 0.87; // an unanswered question is the ideal lead

  return value;
}

/** Scores, filters and sorts hits into leads worth a human's time. */
export function toLeads(hits: Hit[], query: Query, threshold = 0.45): Lead[] {
  const leads: Lead[] = [];
  const seen = new Set<string>();

  for (const hit of hits) {
    if (seen.has(hit.id)) continue;
    seen.add(hit.id);

    const value = relevance(hit, query.terms);
    if (value < threshold) continue;

    leads.push({ hit, topic: query.topic, relevance: value, draft: query.draft });
  }
  return leads.sort((a, b) => b.relevance - a.relevance);
}

/**
 * Collapses a thread that matched several topics down to its best one.
 *
 * Queries overlap by design, so without this the same thread appears twice
 * with two different drafts — which wastes the reader's time and invites
 * replying to it twice.
 */
export function dedupeLeads(leads: Lead[]): Lead[] {
  const best = new Map<string, Lead>();
  for (const lead of leads) {
    const existing = best.get(lead.hit.id);
    if (!existing || lead.relevance > existing.relevance) best.set(lead.hit.id, lead);
  }
  return [...best.values()].sort((a, b) => b.relevance - a.relevance);
}

function ago(date: Date): string {
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  if (days < 1) return "today";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

/** Renders the digest a human reads before deciding what to answer. */
export function render(leads: Lead[], title: string): string {
  const out: string[] = [`# ${title}`, ""];

  if (leads.length === 0) {
    out.push("Nothing worth replying to this run.", "");
    out.push(
      "That is a normal result. Radar is deliberately harsh — a short list you read",
      "properly beats a long one you skim.",
      "",
    );
    return out.join("\n");
  }

  out.push(
    `${leads.length} thread${leads.length === 1 ? "" : "s"} where you could genuinely help.`,
    "",
    "**Read the whole thread before replying.** Answer the question they actually",
    "asked, disclose that you wrote the tool, and rewrite the draft in your own",
    "words — pasting it verbatim is the fastest way to be read as a bot.",
    "",
    "---",
    "",
  );

  const byTopic = new Map<string, Lead[]>();
  for (const lead of leads) {
    const bucket = byTopic.get(lead.topic);
    if (bucket) bucket.push(lead);
    else byTopic.set(lead.topic, [lead]);
  }

  for (const [topic, group] of byTopic) {
    out.push(`## ${topic}`, "");

    for (const lead of group) {
      const { hit } = lead;
      const meta = [
        hit.context ?? hit.source,
        ago(hit.createdAt),
        `${hit.comments ?? 0} comments`,
        `relevance ${lead.relevance.toFixed(2)}`,
      ].join(" · ");

      out.push(`### ${hit.title}`, "", `${meta}`, "", `<${hit.url}>`, "");

      if (hit.text) {
        const excerpt = hit.text.replace(/\s+/g, " ").slice(0, 320);
        out.push(`> ${excerpt}${hit.text.length > 320 ? "…" : ""}`, "");
      }

      out.push("<details><summary>Draft reply — edit before sending</summary>", "");
      out.push("```", lead.draft, "```", "", "</details>", "");
    }
  }
  return out.join("\n");
}
