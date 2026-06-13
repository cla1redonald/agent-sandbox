# Model Router — spec (GREENLIT, not yet built)

> **Status: greenlit by the eval (2026-06-13), not yet built.** The eval
> ([eval/RESULTS.md](../eval/RESULTS.md)) showed a real, useful split: the THINKER
> won the reasoning-hard tasks **4/4** where the CODER managed only **2/4** (it
> fell for the bat-and-ball and non-greedy-coin traps), while the CODER wins all
> coding/easy work and is ~2× faster with 0 timeouts. So routing is worth it —
> **but the rule must be conservative** (default coder; escalate rarely), because
> the thinker is slower, far more verbose, and actually *worse* on some easy tasks
> (it failed LIS and a format-constraint task, and ran away to one timeout).

## Goal

Let the sandboxed agent automatically use the right local model per task —
the fast coder for bulk/agentic edits, the thinker for hard reasoning — without
the user manually `/model`-switching.

## Architecture — a localhost proxy

```
pi  ──►  router-proxy  ──►  Ollama  ──►  qwen3-coder-64k  (coder, fast)
         localhost:11500    :11434  └─►  qwen3.6-64k       (thinker, reasoning)
         OpenAI-compatible
```

- The proxy is a small Node/TS HTTP server exposing an **OpenAI-compatible
  `/v1/chat/completions`** endpoint (same shape pi already speaks to Ollama).
- `pi-safe` points at the proxy port instead of `:11434`. One line changes:
  `--provider ollama` baseUrl → `http://localhost:11500/v1`.
- Everything stays on localhost, so the existing nono profile covers it — add
  `11500` to the profile's `open_port` alongside `11434`.

## The classifier (the actual hard part)

Chosen approach: **tiny-LLM pre-call** — robust, still 100% local/free.

1. On each incoming request, take the last user message.
2. Make ONE fast classification call to the **coder** (it's quick):
   > "Reply with exactly one word — THINK or CODE. THINK if this needs deep
   > multi-step reasoning, math, algorithm design, or careful analysis. CODE for
   > straightforward edits, boilerplate, file ops, or simple changes.\n\nTask: …"
3. Route the real request to `qwen3.6-64k` (THINK) or `qwen3-coder-64k` (CODE).
4. Stream the chosen model's response straight back to pi.

Rejected alternatives (see README): keyword heuristic (brittle), run-coder-then-
escalate (needs reliable failure detection we don't have).

## Routing rules & overrides

- **Default on ambiguity:** CODE (fast path — cheaper to be wrong toward speed).
- **Explicit override:** if the user message contains `/think` or `/code`, honour
  it and skip classification.
- **Long context:** if the prompt is very large (e.g. > 32K tokens), the eval's
  long-context result decides the default (both models handled retrieval fine).

## Failure modes & mitigations

| Risk | Mitigation |
|---|---|
| Classifier mis-routes | Default-to-CODE on low confidence; `/think` override; log every decision |
| Streaming passthrough breaks | Proxy must forward SSE chunks verbatim; test with a streamed request |
| Classifier latency | ~1s on the coder; acceptable. Cache by message hash if it bites |
| Extra daemon to run | Add to `pi-safe` startup, or document a `router-up` command; health-check on boot |
| Proxy down | pi-safe falls back to pointing directly at `:11434` (coder) |

## Test plan — the eval tasks become routing fixtures

Reuse `eval/run-eval.ts`'s 6 tasks: feed each prompt through the **classifier
only** and assert it routes to the model that actually won that task in the eval.
That's a deterministic regression test for the router's decisions.

## Build estimate

~100–150 lines of TS (HTTP server + classify + forward + SSE passthrough). All
local, zero API cost. Half a day including the streaming edge cases.

## Decision gate — PASSED

The eval cleared the bar: thinker 4/4 vs coder 2/4 on reasoning-hard, coder 4/4
on coding and ~2× faster. Build the router with the conservative rule above
(default coder, escalate only on clear hard-reasoning signals). Tune the
classifier so the thinker's weaknesses — easy tasks, format constraints — are
NOT routed to it.
