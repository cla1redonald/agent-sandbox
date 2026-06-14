# Model eval — proving the two-model split

A reproducible, ground-truth benchmark that decides which local model to use for
what. It compares the two sandbox models head-to-head:

- **`qwen3-coder-64k`** — the CODER (fast, direct, no thinking)
- **`qwen3.6-64k`** — the THINKER (hybrid reasoning, thinking on)

Every task has **mechanical ground truth** — no LLM-as-judge (avoids circularity
and cost). Code tasks: the model's output is extracted and **executed inside the
nono sandbox**; the eval is itself sandboxed. Text tasks: exact-match / parse.

## Run it

```sh
cd eval
tsx run-eval.ts                 # both models → writes RESULTS.md
tsx run-eval.ts qwen3-coder-64k # one model only
```

All local via Ollama on `localhost:11434` — zero API cost. The thinker pass is
slow (~20 tok/s, verbose) and can take 20–40 min.

## The tasks (10, three kinds)

| Kind | Tasks | Tests |
|---|---|---|
| **coding** | parse-frontmatter, bugfix-inclusive-range, json-format-discipline, stdlib-only-constraint | everyday agent work + format/constraint discipline |
| **reasoning-easy** | lis-algorithm, long-context-retrieval | algorithm + 40K-token retrieval (the 64K-context claim) |
| **reasoning-hard** | code-trace, logic-deduction, crt-bat-ball, non-greedy-coins | multi-step reasoning + classic traps where fast models slip |

## Verdict (run of 2026-06-13 — see [RESULTS.md](RESULTS.md))

Both scored **8/10 overall**, but the *shape* is the point:

| Kind | coder | thinker |
|---|---|---|
| coding | **4/4** | 3/4 |
| reasoning-easy | **2/2** | 1/2 |
| reasoning-hard | 2/4 | **4/4** |

- **The coder wins everyday work and is ~2× faster** (43 vs 20 tok/s), emits ~19×
  fewer tokens (95 vs 1,780/task), and had **0 timeouts**.
- **The thinker uniquely wins the hard reasoning traps** — bat-and-ball and the
  non-greedy coin problem, which the coder got wrong 0/3.
- But the thinker is **not** strictly better: it failed an *easy* task (LIS — one
  attempt ran away to a 6-min timeout) and was flaky on the stdlib-only
  *constraint* (thinking models over-think and drop format rules).

**Decision:** keep both. **Coder is the default** for all bulk/agentic/coding
work; **escalate to the thinker only for genuinely hard reasoning** (logic, math,
multi-step gotchas) — and for local sensitive-data reasoning that can't go to the
cloud. This split is what justifies the [router](../docs/router-spec.md).

## Honest limitations

- **N is small** (10 tasks, 3 attempts). This is a smoke-grade benchmark, not a
  frontier eval — it shows the split is real, not its exact magnitude.
- temp 0.2 means some flakiness (the coin task swung 2/3 → 0/3 across runs).
- `num_predict` does **not** cap thinking tokens, so a timeout is treated as a
  fail — a fair reflection of "too slow to be usable locally."
