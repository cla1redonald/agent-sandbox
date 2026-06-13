#!/usr/bin/env -S tsx
/**
 * Routing fixtures — does the decider send each task to the model that WON it in
 * the model eval? Ground-truth route by task kind (from eval/RESULTS.md):
 *   coding, reasoning-easy → coder   (coder wins/ties and is ~2x faster)
 *   reasoning-hard         → thinker (the thinker's lane — traps the coder fails)
 *
 * Routing-only: this calls the decider (the 8B classifier), NOT the big models,
 * so it's fast. Run:  tsx router/eval-routing.ts
 */
import { TASKS } from "../eval/run-eval.ts";
import { decide, type Route } from "./decide.ts";

const EXPECTED: Record<string, Route> = {
  coding: "coder",
  "reasoning-easy": "coder",
  "reasoning-hard": "thinker",
};

async function main() {
  let correct = 0;
  const rows: string[] = [];
  for (const t of TASKS) {
    const want = EXPECTED[t.kind];
    const { route, reason } = await decide(t.prompt);
    const ok = route === want;
    if (ok) correct++;
    rows.push(`| ${t.id} | ${t.kind} | ${want} | ${route} (${reason}) | ${ok ? "✅" : "❌"} |`);
    process.stderr.write(`  ${t.id}: want ${want}, got ${route} (${reason}) ${ok ? "ok" : "MISS"}\n`);
  }
  const md =
    `# Routing fixtures\n\nDecider routes (override → heuristic → 8B classifier) vs the eval-winning model.\n\n` +
    `**Accuracy: ${correct}/${TASKS.length}**\n\n` +
    `| Task | kind | expected | routed | ok |\n|---|---|---|---|---|\n${rows.join("\n")}\n`;
  console.log("\n" + md);
}

main();
