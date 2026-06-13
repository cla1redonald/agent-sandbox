#!/usr/bin/env -S tsx
/**
 * Local model eval for the sandbox — proves (or disproves) the two-model split:
 *   qwen3-coder-64k (the CODER, fast)  vs  qwen3.6-64k (the THINKER, reasoning).
 *
 * Each task has MECHANICAL ground truth (no LLM-as-judge — avoids circularity
 * and cost). Code tasks: the model's output is extracted and EXECUTED INSIDE nono
 * (the eval is itself sandboxed). Text tasks: exact-match / parse checks.
 *
 * Run:  cd eval && tsx run-eval.ts            # both models, writes RESULTS.md
 *       tsx run-eval.ts qwen3-coder-64k       # one model only
 *
 * All local via Ollama on localhost:11434 — zero API cost.
 */
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const TMP = join(HERE, ".tmp");
const OLLAMA = "http://localhost:11434/api/chat";

const MODELS = [
  { id: "qwen3-coder-64k", role: "CODER", think: false },
  { id: "qwen3.6-64k", role: "THINKER", think: true },
];
const ATTEMPTS = 3; // best-of-N for stability; task passes on majority
const TEMP = 0.2; // small, so the N attempts actually sample
const NUM_PREDICT = 6144; // bound runtime (thinking models can ramble)

export type Task = {
  id: string;
  kind: "coding" | "reasoning-easy" | "reasoning-hard";
  prompt: string;
  // returns true if the model's raw reply is correct
  check: (reply: string) => Promise<boolean> | boolean;
};

// last integer mentioned in a reply (handles "5 pence", "= 57", "£0.05" etc.)
function lastInt(s: string): number | null {
  const m = s.replace(/,/g, "").match(/-?\d+/g);
  return m ? parseInt(m[m.length - 1], 10) : null;
}
// the first of the given names to appear in the reply
function firstName(reply: string, names: string[]): string | null {
  const found = names
    .map((n) => [reply.toLowerCase().indexOf(n.toLowerCase()), n] as const)
    .filter(([i]) => i >= 0)
    .sort((a, b) => a[0] - b[0]);
  return found.length ? found[0][1] : null;
}

// ---- helpers ---------------------------------------------------------------

function extractCode(text: string): string {
  const m = text.match(/```(?:ts|typescript|js|javascript)?\s*\n([\s\S]*?)```/i);
  return (m ? m[1] : text).replace(/^\s*export\s+/gm, "").trim();
}

// Run model-authored code inside the nono sandbox, call `fn` with each case,
// and compare JSON-stringified output to expected. Returns true iff all match.
function runInSandbox(
  code: string,
  fn: string,
  cases: { args: unknown[]; expected: unknown }[],
): boolean {
  mkdirSync(TMP, { recursive: true });
  // tsx walks UP the tree for a package.json to pick module type; under nono that
  // read is denied outside cwd (EPERM) and tsx aborts. Drop one beside the temp
  // file so the walk stops inside the sandbox's allowed cwd.
  writeFileSync(join(TMP, "package.json"), '{"type":"commonjs"}\n');
  const file = join(TMP, `t_${Math.abs(hash(code + fn))}.ts`);
  const driver =
    code +
    `\n;(${JSON.stringify(cases)}).forEach((c)=>console.log(JSON.stringify((${fn} as any)(...c.args))));\n`;
  writeFileSync(file, driver);
  try {
    const out = execFileSync(
      "nono",
      ["run", "--silent", "--profile", "pi", "--allow-cwd", "--", "tsx", file],
      { cwd: HERE, encoding: "utf8", timeout: 30_000, stdio: ["ignore", "pipe", "ignore"] },
    );
    const lines = out.trim().split("\n");
    if (lines.length !== cases.length) return false;
    return cases.every((c, i) => lines[i] === JSON.stringify(c.expected));
  } catch {
    return false;
  } finally {
    try { rmSync(file); } catch {}
  }
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

const CALL_TIMEOUT_MS = 360_000; // 6-min practical ceiling per call

async function callModel(model: string, think: boolean, prompt: string) {
  const t0 = performance.now();
  // STREAM (stream:true): headers arrive immediately, so a slow thinker can't
  // trip Node fetch's ~5-min headers timeout. Thinking tokens go to
  // message.thinking (separate), so message.content stays clean.
  // NOTE: num_predict does NOT cap thinking tokens — a thinker can run away, so
  // a timeout is caught and treated as a FAIL (too-slow-to-be-usable IS a result).
  try {
    const res = await fetch(OLLAMA, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
      body: JSON.stringify({
        model,
        think,
        stream: true,
        messages: [{ role: "user", content: prompt }],
        options: { temperature: TEMP, num_ctx: 65536, num_predict: NUM_PREDICT },
      }),
    });
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let buf = "", content = "", evalCount = 0, evalDur = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        const o: any = JSON.parse(line);
        if (o.message?.content) content += o.message.content;
        if (o.done) { evalCount = o.eval_count ?? 0; evalDur = o.eval_duration ?? 0; }
      }
    }
    const evalSec = evalDur / 1e9;
    return {
      content: content.trim(),
      tokens: evalCount,
      tokPerSec: evalSec ? evalCount / evalSec : 0,
      ms: performance.now() - t0,
      timedOut: false,
    };
  } catch (e: any) {
    const timedOut = e?.name === "TimeoutError";
    process.stderr.write(`    ! ${model} call ${timedOut ? "TIMED OUT" : "errored: " + e?.message}\n`);
    return { content: "", tokens: 0, tokPerSec: 0, ms: performance.now() - t0, timedOut };
  }
}

// ---- the 6 tasks -----------------------------------------------------------

const LONGDOC = (() => {
  const filler = "The vault archive contains routine maintenance logs. ".repeat(1200);
  const half = Math.floor(filler.length / 2);
  return filler.slice(0, half) + "\nNOTE: The access code for vault 7 is MARMALADE-42.\n" + filler.slice(half);
})();

export const TASKS: Task[] = [
  {
    id: "lis-algorithm",
    kind: "reasoning-easy",
    prompt:
      "Write a TypeScript function `function solve(nums: number[]): number` that returns the length of the longest strictly increasing subsequence. Reply with only the function in a single ```ts code block.",
    check: (r) =>
      runInSandbox(extractCode(r), "solve", [
        { args: [[10, 9, 2, 5, 3, 7, 101, 18]], expected: 4 },
        { args: [[0, 1, 0, 3, 2, 3]], expected: 4 },
        { args: [[7, 7, 7]], expected: 1 },
        { args: [[]], expected: 0 },
      ]),
  },
  {
    id: "parse-frontmatter",
    kind: "coding",
    prompt:
      "Write a TypeScript function `function solve(md: string): Record<string,string>` that extracts the YAML frontmatter (the `key: value` lines inside the leading `---` block) into an object. Trim keys and values. If there is no frontmatter block, return {}. Reply with only the function in a single ```ts code block.",
    check: (r) =>
      runInSandbox(extractCode(r), "solve", [
        { args: ["---\ntitle: Hello\ntags: idea\n---\nbody"], expected: { title: "Hello", tags: "idea" } },
        { args: ["no frontmatter here"], expected: {} },
      ]),
  },
  {
    id: "bugfix-inclusive-range",
    kind: "coding",
    prompt:
      "This function should sum every integer from a to b INCLUSIVE but has a bug:\n```ts\nfunction sumRange(a: number, b: number): number { let s = 0; for (let i = a; i < b; i++) s += i; return s; }\n```\nReturn the corrected function named `sumRange`. Reply with only the function in a single ```ts code block.",
    check: (r) =>
      runInSandbox(extractCode(r), "sumRange", [
        { args: [1, 5], expected: 15 },
        { args: [3, 3], expected: 3 },
        { args: [0, 10], expected: 55 },
      ]),
  },
  {
    id: "json-format-discipline",
    kind: "coding",
    prompt:
      'Output ONLY a JSON object (no prose, no markdown code fence) with exactly two keys: "name" set to the string "sandbox", and "squares" set to an array of the first five square numbers starting at 1. ',
    check: (r) => {
      try {
        const o = JSON.parse(r.trim().replace(/^```\w*\n?|\n?```$/g, ""));
        return o.name === "sandbox" && JSON.stringify(o.squares) === JSON.stringify([1, 4, 9, 16, 25]);
      } catch {
        return false;
      }
    },
  },
  {
    id: "stdlib-only-constraint",
    kind: "coding",
    prompt:
      "Write a TypeScript function `function solve(s: string): number` that counts the vowels (a,e,i,o,u, case-insensitive) in a string. Use ONLY built-in JavaScript — no imports, no require. Reply with only the function in a single ```ts code block.",
    check: (r) => {
      const code = extractCode(r);
      if (/\b(import|require)\b/.test(code)) return false; // constraint violated
      return runInSandbox(code, "solve", [
        { args: ["Hello World"], expected: 3 },
        { args: ["xyz"], expected: 0 },
        { args: ["AEIOU"], expected: 5 },
      ]);
    },
  },
  {
    id: "long-context-retrieval",
    kind: "reasoning-easy",
    prompt: `${LONGDOC}\n\nQuestion: What is the access code for vault 7? Answer with ONLY the code, nothing else.`,
    check: (r) => /MARMALADE-42/.test(r),
  },
  // ---- reasoning-hard: where a fast model typically slips and a thinker should win
  {
    id: "code-trace",
    kind: "reasoning-hard",
    prompt:
      "Given this function:\n```ts\nfunction g(n: number): number { if (n === 0) return 2; return g(n - 1) + n * n; }\n```\nWhat is g(5)? Work it out and answer with only the number.",
    check: (r) => lastInt(r) === 57, // 2,3,7,16,32,57
  },
  {
    id: "logic-deduction",
    kind: "reasoning-hard",
    prompt:
      "Five runners finished a race. Ned finished before Tom. Sue finished after Rosa. Tom finished before Rosa. Uma finished after Sue. Who finished FIRST? Answer with just the name.",
    check: (r) => firstName(r, ["Ned", "Tom", "Rosa", "Sue", "Uma"]) === "Ned", // Ned<Tom<Rosa<Sue<Uma
  },
  {
    id: "crt-bat-ball",
    kind: "reasoning-hard",
    prompt:
      "A bat and a ball cost £1.10 in total. The bat costs £1.00 more than the ball. How many pence does the ball cost? Answer with only the number.",
    check: (r) => lastInt(r) === 5, // intuitive-but-wrong answer is 10
  },
  {
    id: "non-greedy-coins",
    kind: "reasoning-hard",
    prompt:
      "You have unlimited coins worth 1, 3, and 4. What is the fewest coins needed to make exactly 6? Answer with only the number.",
    check: (r) => lastInt(r) === 2, // greedy (4+1+1) gives 3; optimal is 3+3
  },
];

// ---- run -------------------------------------------------------------------

async function main() {
  const only = process.argv[2];
  const models = only ? MODELS.filter((m) => m.id === only) : MODELS;
  const rows: string[] = [];
  const perTask: Record<string, Record<string, string>> = {};
  const KINDS = ["coding", "reasoning-easy", "reasoning-hard"] as const;
  const byKind: Record<string, Record<string, { pass: number; total: number }>> = {};

  for (const m of models) {
    let passed = 0, tokSum = 0, tpsSum = 0, tpsN = 0, n = 0, timeouts = 0;
    byKind[m.id] = Object.fromEntries(KINDS.map((k) => [k, { pass: 0, total: 0 }]));
    for (const task of TASKS) {
      let ok = 0;
      for (let a = 0; a < ATTEMPTS; a++) {
        const out = await callModel(m.id, m.think, task.prompt);
        tokSum += out.tokens;
        if (out.tokPerSec > 0) { tpsSum += out.tokPerSec; tpsN++; }
        if (out.timedOut) timeouts++;
        n++;
        if (await task.check(out.content)) ok++;
        process.stderr.write(`  ${m.id} · ${task.id} · attempt ${a + 1}: ${ok}/${a + 1} ok\n`);
      }
      const taskPass = ok >= Math.ceil(ATTEMPTS / 2);
      if (taskPass) passed++;
      byKind[m.id][task.kind].total++;
      if (taskPass) byKind[m.id][task.kind].pass++;
      (perTask[task.id] ??= {})[m.id] = `${ok}/${ATTEMPTS}${taskPass ? " ✅" : " ❌"}`;
    }
    rows.push(
      `| **${m.id}** (${m.role}) | ${passed}/${TASKS.length} | ${tpsN ? (tpsSum / tpsN).toFixed(1) : "—"} | ${Math.round(tokSum / n)} | ${timeouts} |`,
    );
  }

  let md = `# Eval results\n\nGenerated by \`eval/run-eval.ts\` — ${ATTEMPTS} attempts/task, temp ${TEMP}, all local. A timeout (>${CALL_TIMEOUT_MS / 60000} min/call) counts as a fail.\n\n`;
  md += `| Model | Pass (maj. of ${ATTEMPTS}) | Mean tok/s | Mean tokens/task | Timeouts |\n|---|---|---|---|---|\n${rows.join("\n")}\n\n`;
  md += `## By task kind\n\n| Kind | ${models.map((m) => m.id).join(" | ")} |\n|---|${models.map(() => "---").join("|")}|\n`;
  for (const k of KINDS) {
    md += `| ${k} | ${models.map((m) => `${byKind[m.id][k].pass}/${byKind[m.id][k].total}`).join(" | ")} |\n`;
  }
  md += `\n## Per-task (${TASKS.length} tasks)\n\n| Task | kind | ${models.map((m) => m.id).join(" | ")} |\n|---|---|${models.map(() => "---").join("|")}|\n`;
  for (const t of TASKS) {
    md += `| ${t.id} | ${t.kind} | ${models.map((m) => perTask[t.id]?.[m.id] ?? "-").join(" | ")} |\n`;
  }
  writeFileSync(join(HERE, "RESULTS.md"), md);
  process.stderr.write("\nWrote eval/RESULTS.md\n");
  console.log(md);
}

// run only when invoked directly (so the router can import TASKS without running the eval)
if ((process.argv[1] ?? "").endsWith("run-eval.ts")) main();
