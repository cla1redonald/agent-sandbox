/**
 * Router decider — PHASE 2. Picks coder vs thinker for a request, cheap → dear:
 *   1. explicit override  (/think, /code)
 *   2. high-precision regex heuristic (only fires when confident)
 *   3. llama3.1:8b classifier (pinned resident; ~0.5-1s) for the ambiguous rest
 * Conservative: anything unclear → coder (the fast default). No hysteresis yet
 * (Phase 3). See docs/router-plan.md.
 */
const OLLAMA = process.env.OLLAMA_URL ?? "http://localhost:11434";
const CLASSIFIER = "llama3.1:8b";

export type Route = "coder" | "thinker";
export interface Decision {
  route: Route;
  reason: "override" | "heuristic" | "classifier" | "classifier-fallback";
}

const THINK_OVERRIDE = /(^|\s)\/think\b/i;
const CODE_OVERRIDE = /(^|\s)\/code\b/i;

// Only fire heuristics when confident; otherwise fall through to the classifier.
const THINK_HINTS =
  /\b(prove|proof|step[- ]by[- ]step|reason through|logic puzzle|riddle|how many|fewest|minimum number|optimal|why does|explain why|brain ?teaser)\b/i;
const CODE_HINTS =
  /\b(refactor|rename|add (a |an )?(function|test|param|endpoint)|implement|write (a |an )?(function|file|script|test|class)|fix (the|this)|edit|format|lint|stack ?trace|compile|typescript|npm|import)\b/i;

// Classify on a trimmed view — never send a 40K-token prompt to the classifier.
function snippet(s: string, n = 1500): string {
  return s.length <= 2 * n ? s : `${s.slice(0, n)}\n…\n${s.slice(-n)}`;
}

export async function decide(message: string): Promise<Decision> {
  if (THINK_OVERRIDE.test(message)) return { route: "thinker", reason: "override" };
  if (CODE_OVERRIDE.test(message)) return { route: "coder", reason: "override" };

  const t = THINK_HINTS.test(message);
  const c = CODE_HINTS.test(message);
  if (t && !c) return { route: "thinker", reason: "heuristic" };
  if (c && !t) return { route: "coder", reason: "heuristic" };

  return classify(message);
}

async function classify(message: string): Promise<Decision> {
  const prompt =
    `You route coding-assistant tasks to one of two local models. Decide:\n` +
    `THINK = needs deep multi-step reasoning: logic puzzles, math, tricky/"gotcha" ` +
    `problems, careful multi-constraint deduction.\n` +
    `CODE = everyday work: writing or editing code, file operations, formatting, ` +
    `simple lookups, retrieving a fact from text.\n\n` +
    `Reply with exactly one word: THINK or CODE.\n\nTask:\n${snippet(message)}\n\nAnswer:`;
  try {
    const res = await fetch(`${OLLAMA}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({
        model: CLASSIFIER,
        think: false,
        stream: false,
        keep_alive: -1, // pin the classifier resident so routing never reloads it
        messages: [{ role: "user", content: prompt }],
        options: { temperature: 0, num_predict: 4 },
      }),
    });
    const j: any = await res.json();
    const out = (j.message?.content ?? "").toUpperCase();
    return { route: out.includes("THINK") ? "thinker" : "coder", reason: "classifier" };
  } catch {
    return { route: "coder", reason: "classifier-fallback" }; // fail safe to fast default
  }
}
