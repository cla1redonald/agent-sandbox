#!/usr/bin/env -S tsx
/**
 * Proves hysteresis cuts reloads vs immediate-switch (Phase 2 behaviour), on the
 * exact same request sequences. Pure/deterministic — no model calls.
 *   tsx router/test-hysteresis.ts
 */
import { Hysteresis } from "./hysteresis.ts";
import type { Route } from "./decide.ts";

// immediate-switch baseline (Phase 2): every change of wanted model = a reload
function immediateSwitches(seq: Route[], start: Route = "coder"): number {
  let cur = start, n = 0;
  for (const w of seq) { if (w !== cur) { n++; cur = w; } }
  return n;
}

function hysteresisSwitches(seq: Route[]): number {
  const h = new Hysteresis("coder");
  let n = 0;
  for (const w of seq) { if (h.next(w, false).switched) n++; }
  return n;
}

const T: Route = "thinker", C: Route = "coder";
const CASES: { name: string; seq: Route[] }[] = [
  { name: "alternating C/T x3", seq: [C, T, C, T, C, T] },
  { name: "sustained: 3 code then 3 reason", seq: [C, C, C, T, T, T] },
  { name: "mostly code, one hard spike", seq: [C, C, T, C, C, C] },
  { name: "genuine shift to coding", seq: [T, C, C, C] },
  { name: "noisy bounce", seq: [C, T, T, C, T, C, C, T] },
];

let pass = 0;
console.log("\n| sequence | immediate reloads | hysteresis reloads | fewer? |");
console.log("|---|---|---|---|");
for (const { name, seq } of CASES) {
  const imm = immediateSwitches(seq);
  const hys = hysteresisSwitches(seq);
  const ok = hys <= imm;
  if (ok) pass++;
  console.log(`| ${name} (${seq.map((r) => r[0].toUpperCase()).join("")}) | ${imm} | ${hys} | ${hys < imm ? "✅ " + (imm - hys) + " fewer" : hys === imm ? "= same" : "❌ MORE"} |`);
}

// spot-check the asymmetry on a concrete trace
console.log("\nTrace — [C,T,C,T] from coder (escalate fast, de-escalate slow):");
const h = new Hysteresis("coder");
for (const w of [C, T, C, T] as Route[]) {
  const r = h.next(w, false);
  console.log(`  want ${w} -> run ${r.model} ${r.switched ? "(RELOAD)" : ""}  [${r.note}]`);
}

console.log(`\n${pass}/${CASES.length} sequences: hysteresis never increases reloads.`);
if (pass !== CASES.length) process.exit(1);
