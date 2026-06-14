# Model Router — implementation plan

Companion to [router-spec.md](router-spec.md) (the why + decision gate, passed).
This is the locked architecture and build sequence.

> **Status: BUILT 2026-06-14.** All five phases shipped in `router/`. Phase 1
> streaming pass-through (curl-verified), Phase 2 decider (routing fixtures
> 10/10), Phase 3 hysteresis (5→1 reloads) + thinker leash + coder fallback,
> Phase 4 pi-safe auto-spawn + nono `:11500` (sandbox canary re-passed). The one
> unproven path is a full *interactive* pi session through the router — pi is a
> TUI that can't be driven headlessly; everything beneath it is verified.

## Locked decisions (architecting session, 2026-06-13)

| Decision | Choice | Why |
|---|---|---|
| Classifier | **`llama3.1:8b` always-on** (`keep_alive: -1`) | 4.9GB co-resides with either big model → classifying never causes a reload |
| Switch policy | **Sticky + hysteresis** | a big-model switch costs ~20s; bias toward not reloading |
| Lifecycle | **`pi-safe` auto-spawns** the proxy | one command, no separate daemon to remember |
| Language / runtime | **TypeScript (tsx), host process** (not sandboxed) | trusted infra, like Ollama itself |
| Interface | OpenAI-compat `/v1/chat/completions` on **:11500** | pi already speaks this; drop-in baseUrl swap |

## The hard constraint (drives the whole design)

On 48GB, **only one big model fits loaded at a time** (coder ~24GB *or* thinker
~28GB; both = ~52GB). Every coder↔thinker switch = a ~20s cold reload. The router
is built to *minimise reloads*, not just classify correctly. The 4.9GB classifier
is the trick: it stays resident next to whichever big model is loaded
(5+28 = 33GB ✓), so routing decisions are free; only a genuine escalation reloads.

```
pi (sandboxed) ─► router-proxy (host, :11500, OpenAI-compat) ─► Ollama :11434
                      │                                          ├─ qwen3-coder-64k  coder  ~24GB
                      │  classify (cheap) ┐                       ├─ qwen3.6-64k      thinker ~28GB
                      └───────────────────┴──────────────────────┴─ llama3.1:8b      classifier ~5GB (pinned)
```

## Components

1. **HTTP server** — `/v1/chat/completions` (stream + non-stream) + `/health`.
2. **Decider** — layered: `/think`·`/code` override → regex heuristic → 8B classifier. Returns `coder | thinker`.
3. **Hysteresis state** — current loaded big model + a small vote buffer; only flips on a confident/repeated opposite signal or an explicit override.
4. **Forwarder** — rewrites the request to the chosen Ollama model, streams chunks back verbatim; pins the classifier with `keep_alive: -1`; sets a wall-clock cap on thinker calls and falls back to coder on timeout.
5. **pi-safe integration** — health-check :11500; if down, spawn the proxy in the background, wait for health, then launch pi with `--model auto` at the proxy baseUrl. `PI_NO_ROUTER=1` bypasses to direct coder.
6. **nono profile** — add `11500` to `open_port` (+ `allow_domain`) so sandboxed pi can reach the proxy.
7. **router-eval mode** — reuse the 10 eval tasks as routing fixtures: feed each prompt through the decider only, assert it lands on the model that won that task.

## Request flow

1. pi POSTs `/v1/chat/completions` with `model: "auto"` (streaming).
2. Decider on the **last user message**:
   - contains `/think` or `/code` → force that model, reset hysteresis;
   - else regex heuristic catches obvious cases (tiny edits → coder; "prove/why/step-by-step/puzzle" → thinker);
   - else 8B classifier returns `THINK|CODE` (think=false, num_predict≈4, temp 0).
3. Hysteresis: if the pick == loaded model → use it. If different → only switch after the configured confidence/repeat threshold; otherwise stay (note it in logs).
4. Forward to the chosen big model, stream back. Thinker calls carry a wall-clock cap; on timeout, abort and retry once on the coder.
5. Log every decision (`{route, reason, switched, ms}`) for tuning.

## Phases (each ends with a concrete, verifiable deliverable)

- **Phase 1 — pass-through proxy.** Server that forwards to the coder only, streaming verbatim. *Verify:* `curl` a streamed completion AND a real `pi-safe --router` session work end-to-end. (Proves the streaming bridge before any routing — the riskiest plumbing first.)
- **Phase 2 — decider (no hysteresis).** Override + heuristic + 8B classifier, switch immediately. *Verify:* router-eval fixtures — each task routes to its eval-winning model; report routing accuracy.
- **Phase 3 — hysteresis + thinker leash.** Add sticky state + the wall-clock cap/fallback. *Verify:* a scripted alternating-task conversation triggers far fewer reloads than Phase 2 (count loads via `ollama ps`).
- **Phase 4 — pi-safe auto-spawn + nono profile.** Health-check/spawn logic, `11500` in the profile, `PI_NO_ROUTER` bypass. *Verify:* fresh shell → `pi-safe` brings the proxy up and a sandboxed run reaches it; re-run the sandbox boundary canary test (profile change didn't widen access).
- **Phase 5 — docs + tuning.** Fold results into README/ARCHITECTURE, document `router-up`/bypass, record routing accuracy. *Verify:* the diagram + "which model when" reflect the live router.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Reload thrash | Always-on 8B classifier + sticky hysteresis (the core design) |
| Thinking runaway (no `num_predict` cap on thinking) | Wall-clock cap per thinker call → abort + coder fallback |
| Streaming edge cases | Built and proven first (Phase 1) before routing logic |
| Classifier mis-routes | Heuristic + override shortcuts; fixtures measure accuracy; default-to-coder on low confidence |
| Proxy crash mid-session | pi-safe health-check; `PI_NO_ROUTER=1` falls back to direct coder |
| Two pi sessions share one proxy | Single-user assumption; loaded model is global to Ollama anyway. Note as known limitation |
| Profile change widens sandbox | Re-run the canary/boundary test in Phase 4 |

## Estimate

~½–1 day across the five phases, all local / zero API cost. Phase 1 is the only
real plumbing risk; everything after is logic on top of a proven bridge.
