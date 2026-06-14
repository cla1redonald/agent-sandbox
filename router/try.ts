#!/usr/bin/env -S tsx
/**
 * Throw prompts at the decider and see where they route. Tuning aid.
 *   tsx router/try.ts                      # the default battery
 *   tsx router/try.ts "your prompt here"   # one ad-hoc prompt
 */
import { decide } from "./decide.ts";

// [prompt, my-judgment expected route] — expectations are a human guess, not measured
const BATTERY: [string, string][] = [
  // everyday coding → coder
  ["Add a dark mode toggle to this React component.", "coder"],
  ["Rename the variable foo to userCount everywhere in this file.", "coder"],
  ["Convert this callback-based function to use async/await.", "coder"],
  ["What's the capital of France?", "coder?"],
  // hard reasoning → thinker
  ["Three guests pay $30 for a room, the clerk refunds $5 via a bellhop who pockets $2... where's the missing dollar?", "thinker"],
  ["If all Bloops are Razzies and some Razzies are Lazzies, does it follow that some Bloops are Lazzies?", "thinker"],
  ["A farmer must cross a river with a fox, a chicken, and a sack of grain; the boat holds one item. What order?", "thinker"],
  // genuinely ambiguous — code + reasoning mixed
  ["Design an algorithm to find the median of two sorted arrays in O(log n).", "either"],
  ["Refactor this function to be more efficient — think carefully about the time complexity.", "either"],
  ["Explain why this sort is O(n log n).", "thinker?"],
  ["Write a regex to validate an email, and walk through the tricky edge cases.", "either"],
  // overrides should win regardless of content
  ["/think what is 2 + 2?", "thinker (override)"],
  ["/code prove the Pythagorean theorem.", "coder (override)"],
];

async function main() {
  const args = process.argv.slice(2);
  const rows: [string, string][] = args.length ? args.map((a) => [a, "?"]) : BATTERY;
  console.log(`\n| route | reason | expected | prompt |`);
  console.log(`|---|---|---|---|`);
  for (const [prompt, expected] of rows) {
    const { route, reason } = await decide(prompt);
    const short = prompt.length > 64 ? prompt.slice(0, 61) + "…" : prompt;
    console.log(`| ${route} | ${reason} | ${expected} | ${short} |`);
  }
}
main();
