# HANDOFF — agent-sandbox

_Last updated: 2026-06-23_

## Session Summary

Took the sandbox from a single local model to an **eval-driven two-model setup with an automatic router**, all merged to `main`:

- **Evaluated** Qwen3.6 35B-A3B vs the incumbent Qwen3-Coder 30B-A3B (instead of blindly "upgrading"). Built a reproducible ground-truth eval (`eval/`, 10 tasks, code executed inside the nono sandbox). Result: neither dominates — coder wins coding/easy + is ~2× faster (43 vs 20 tok/s, 0 timeouts); thinker wins reasoning-hard (4/4 vs 2/4) but is verbose and can run away. → **keep both**.
- **Two models:** `qwen3-coder-64k` (CODER, fast default) + `qwen3.6-64k` (THINKER, hard reasoning / local sensitive-data work). Config wired in `pi-safe` + `models.json`; old model kept as fallback.
- **Built the router** (`router/`, 5 phases) — a localhost OpenAI-compat proxy on `:11500` that auto-picks the model per request:
  - Phase 1: streaming pass-through (curl-verified)
  - Phase 2: decider (override → regex heuristic → pinned `llama3.1:8b` classifier) — routing fixtures **10/10**
  - Phase 3: hysteresis (alternating C/T **5→1** reloads) + thinker wall-clock leash → clean coder fallback
  - Phase 4: `pi-safe` auto-spawns the proxy + nono profile opens `:11500` — **sandbox canary re-passed** (SSH keys/.zshrc/Keychain still denied)
  - Phase 5: docs (README/ARCHITECTURE/spec/plan)
- Also clarified earlier: Cline (Ollama integration) and Kimi K2.7 / `:cloud` models are **not** for this sandbox (cloud = billed + leaves machine; breaks the sandbox's two promises).

## Current State

- **`main`:** router + docs both MERGED (PRs #4 + #5, 2026-06-14; tip `da791da`). Router present on main (7 files in `router/`).
- **`chore/gitignore-env` MERGED** (PR #6, 2026-06-23) — `.gitignore` now ignores `.env`/`*.pem`; fixed an ARCHITECTURE router link. main is current.
- **This handoff** is on branch `handoff`.
- **Models present:** `qwen3-coder-64k`, `qwen3.6-64k`, `llama3.1:8b` (router classifier), `qwen2.5:32b`, `qwen3-coder:30b`, `qwen3.6:35b-a3b`.
- **Tests:** `tsx router/test-hysteresis.ts` → 5/5; `tsx router/eval-routing.ts` → 10/10. No known lint/build errors (plain TS run via tsx; no CI in this repo).
- **Deploy:** n/a (local tooling repo).

## Open Issues

- **Interactive pi-through-router smoke test — PENDING (the only unproven path).** pi is a TUI and can't be driven headlessly. Everything beneath it is verified (decider, hysteresis, leash, proxy, sandbox, auto-spawn) but a real `pi-safe` session doing work through the router hasn't been run. **Action:** `cd ~/some-project && pi-safe`, paste a coding prompt then a logic puzzle, watch `tail -f /tmp/pi-router.log` for `stay` vs `escalate … RELOAD`.
- **Heuristic/classifier tuning** — decider generalised well on a fresh battery but real prompts will surface gaps. `router/decide.ts` holds the regex hints; `router/try.ts "prompt"` shows a route in isolation; `router/eval-routing.ts` is the regression check.
- **Short held-leash (30s) path not re-timed live** — sound by construction (`router/server.ts` `HELD_LEASH_MS`), but a fresh runaway wasn't forced to re-measure it.
- **`models.json` `auto` model has `reasoning:false`** — verify pi renders the thinker's `reasoning` field acceptably in a real session; adjust if it looks off.

## Resume Prompt

```
Resume the agent-sandbox router work (~/code/agent-sandbox, all on main; PRs #4/#5 merged).
The router (router/) auto-routes coder<->thinker via a localhost proxy on :11500; pi-safe
auto-spawns it. I've now run the interactive pi-through-router smoke test — here's how it
routed in practice: <PASTE what happened + any misroutes>. Help me tune router/decide.ts
(heuristics + the llama3.1:8b classifier prompt) for my real prompts, re-running
router/eval-routing.ts (must stay 10/10) and router/try.ts as regression checks. Also
sanity-check the `auto` model's reasoning:false handling and the 30s held-leash path.
```
