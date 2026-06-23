# Architecture — Local Agentic AI Sandbox

This documents how my local agentic coding setup works, so I (or anyone) can
understand and explain it. Set up 2026-06-12, inspired by
[Willem van den Ende's local agentic dev setup](https://willemvandenende.com/blog/engineering/my-local-agentic-dev-setup-today),
adapted for my machine. On 2026-06-13 a second model — a *thinker* (Qwen3.6)
— was added alongside the fast *coder* (Qwen3-Coder) after a head-to-head eval;
see [the model section](#model-two-models-the-coder-and-the-thinker).

## The one-sentence version

I run AI coding agents on my own laptop using a **local model** (nothing leaves
the machine, zero API cost), wrapped in a **kernel-level sandbox** so a
misbehaving agent can only touch the folder I point it at — not my SSH keys,
passwords, or the rest of my system.

## Why this exists

- **Privacy** — the model runs locally, so client data / private code never
  goes to a third-party API.
- **Safety** — agents can run shell commands. The sandbox means "let the agent
  run wild" is actually safe: it's boxed into one directory.
- **Cost** — local inference is free, so bulk/mechanical work doesn't burn API
  credits. Premium cloud models (Claude) are saved for the hard reasoning.

## The four pieces

```
   You type a task
        │
        ▼
┌─────────────────────────────────────────────────────────┐
│  nono  (the sandbox / jail)                              │
│  Kernel-level (macOS Seatbelt). Decides what the agent   │
│  inside is allowed to read, write, and connect to.       │
│                                                          │
│   ┌───────────────────────────────────────────────┐     │
│   │  pi  (the coding agent)                        │     │
│   │  CLI that plans, reads/writes files, runs bash │     │
│   │           │                                    │     │
│   │           ▼  asks the model what to do          │     │
│   │  ┌──────────────────────────────────────┐      │     │
│   │  │  router :11500  (classify, pick model)│      │     │
│   │  │     │                                  │      │     │
│   │  │     ▼  Ollama on localhost:11434       │      │     │
│   │  │   qwen3-coder-64k (coder, default)     │      │     │
│   │  │   qwen3.6-64k     (thinker, hard)      │      │     │
│   │  │   llama3.1:8b     (router classifier)  │      │     │
│   │  └──────────────────────────────────────┘      │     │
│   └───────────────────────────────────────────────┘     │
│                                                          │
│  Allowed: the working folder, ~/.pi, localhost 11434+11500│
│  Denied:  SSH keys, Keychain, ~/.zshrc, browser data,    │
│           shell history, everything outside the folder   │
└─────────────────────────────────────────────────────────┘
```

| Piece | Role | What it is |
|---|---|---|
| **nono** 0.62 | The sandbox. Enforces what the agent can touch, at the kernel level. | `brew install nono`. Uses macOS Seatbelt; the policy is irrevocable once applied. |
| **Ollama** 0.24 | Runs the model locally, exposes an OpenAI-compatible API on `localhost:11434`. | Already installed. |
| **qwen3-coder-64k** | The CODER (fast default) — Qwen3-Coder 30B-A3B (MoE, ~3.3B active), 64K context. | Built from `Modelfile`. ~18GB. |
| **qwen3.6-64k** | The THINKER (hard reasoning) — Qwen3.6 35B-A3B (MoE, ~3B active), 64K context, hybrid reasoning. | Built from `Modelfile`. ~23GB. Added 2026-06-13. |
| **pi** 0.79 | The coding agent — the thing that actually reads files, edits, runs commands. | `npm i -g --ignore-scripts @earendil-works/pi-coding-agent`. Pointed at Ollama. |

## Why this stack (and what the alternatives were)

Each piece was a deliberate choice. Here's the reasoning and the roads not taken.

### Sandbox: nono — vs Docker, devcontainers, a VM, or nothing

- **Why nono:** it sandboxes a *normal process on the host* using the OS's own
  kernel mechanism (Seatbelt on macOS, Landlock on Linux). No container image,
  no daemon, no VM, near-zero startup cost — and the policy is *irrevocable
  once applied*, so the agent can't lift its own restrictions. You point it at
  a folder and the agent simply cannot read anything else.
- **Docker / devcontainers** would also isolate, but mean building and
  maintaining images, a running daemon, slower startup, and friction reaching
  local tools and the host model server. Heavier than needed to answer the one
  question that matters here: "what can this agent touch?"
- **A full VM** is the strongest isolation but the heaviest — slow, resource-
  hungry, awkward for everyday "open a folder and go" work.
- **Nothing (just run the agent)** is what most people do, and it's the actual
  risk this setup removes: an unsandboxed agent with a shell can read your SSH
  keys, tokens, and `~/.zshrc`, or run a destructive command. The whole point
  is to make "let it run autonomously" safe.

### Inference: Ollama — vs llama.cpp, LM Studio, MLX, cloud APIs

- **Why Ollama:** already installed, dead-simple model management
  (`ollama pull` / `ollama create`), and an OpenAI-compatible server out of the
  box so any agent can point at it. Lowest friction to a working setup.
- **llama.cpp** is what the original blog uses, and it's the deliberate
  deviation here. It's faster and gives finer control (exact context size,
  quant, sampling, reasoning flags) — but you build it from source and manage
  models by hand. *If raw speed or control becomes the bottleneck, this is the
  upgrade path.* Ollama actually runs llama.cpp underneath, so it's the same
  engine with a friendlier wrapper.
- **LM Studio** is a nice GUI but more of a desktop app than a scriptable
  server. **MLX** is Apple-native and fast but a smaller ecosystem.
- **Cloud APIs (Claude, GPT)** are far more capable — but defeat the two goals
  this setup exists for: privacy (data leaves the machine) and zero cost. They
  remain the right tool for hard reasoning; see the split below.

### Model: two models — the coder and the thinker

The sandbox launched (2026-06-12) on **Qwen3-Coder 30B-A3B**. When **Qwen3.6
35B-A3B** (the current-gen Qwen, a hybrid *reasoning* model) appeared, the
obvious move was to "upgrade." Instead I **evalled it head-to-head** — and the
result said *don't replace, add*. So the setup now runs two models:

- **`qwen3-coder-64k` — the CODER (fast default).** Direct, no thinking, ~18GB.
- **`qwen3.6-64k` — the THINKER (on demand).** Hybrid reasoning, ~23GB.

**Why both, not one (the eval — [eval/](../eval/)):** a 10-task ground-truth
benchmark, both models, run inside the sandbox. Both scored 8/10 overall, but
split by *kind*:

| Kind | coder | thinker |
|---|---|---|
| coding | **4/4** | 3/4 |
| reasoning-easy | **2/2** | 1/2 |
| reasoning-hard | 2/4 | **4/4** |

The coder wins everyday work and is ~2× faster (43 vs 20 tok/s), ~19× less
verbose (95 vs 1,780 tokens/task), with 0 timeouts. The thinker uniquely solves
the hard-reasoning traps (bat-and-ball, non-greedy coins) the coder fails — but
it's slower, far more verbose, *worse* on some easy tasks (it failed LIS), and
ran away to a timeout once. Neither dominates → keep both, default to the coder,
escalate to the thinker only for genuinely hard reasoning. That choice is now
automated by the [router](docs/router-plan.md) — a localhost proxy (`:11500`)
that classifies each request (override → heuristic → an always-on `llama3.1:8b`)
and picks the model, with hysteresis to resist the ~20s reload and a wall-clock
leash that falls back to the coder if the thinker runs away. `pi-safe` routes
through it by default; `PI_NO_ROUTER=1` bypasses to the direct coder.

**Discovery worth recording:** Qwen3.6 *thinks by default* and `num_predict`
does **not** cap thinking tokens, so it can monologue for minutes on a trivial
task. A `SYSTEM /no_think` Modelfile directive does **not** reliably suppress it
— only the runtime `--think=false` flag (or pi's `reasoning:false`) does. That's
why the fast path is a separate coder model, not Qwen3.6 in no-think mode.

**Why these two and not the other candidates:**

| Model | Fit on 48GB | Why / why not |
|---|---|---|
| **Qwen3-Coder 30B-A3B (MoE)** ← *coder* | ~18GB, very comfortable | Fast MoE (~3.3B active), coding-tuned, no thinking overhead. Won the eval's coding + easy tasks and is 2× faster. The default. |
| **Qwen3.6 35B-A3B (MoE)** ← *thinker* | ~23GB, comfortable | Current-gen hybrid reasoner. Won the eval's hard-reasoning 4/4. Kept for that lane + local sensitive-data reasoning. |
| Qwen3-Coder-Next (80B MoE) | ✗ too tight | Tops open agentic-coding benchmarks, but 80B even at 4-bit crowds 48GB once KV cache + OS are counted — swap-thrash. A 64GB+ pick. |
| Qwen3.6 27B *dense* | △ fits, slower | Higher per-token quality, but dense = full 27B every token → slower. The MoE's speed-per-GB wins for agent loops. |
| Qwen3.6 `…-coding-mxfp8` / `-nvfp4` | ✗ wrong hardware | Coding-tuned quants ship in NVIDIA microscaling formats (FP8/FP4) for Blackwell datacenter GPUs — not Apple Metal. The default quant is the Mac-safe one. |
| Gemma 4 26B-A4B (MoE) | ✅ fits | Reasonable non-Qwen alternative. Passed over because Qwen leads open agentic-coding and the toolchain was already tuned for it — revisit if Qwen regresses. |
| Smaller (7–8B, e.g. `llama3.1:8b`) | ✅ trivially | Fast, fine for trivial edits, kept around — but weak at multi-step agent work. |
| Kimi K2.7 Code | ✗ not local | Cloud-only (~1T params) and billed — sending code off-machine for a fee breaks the sandbox's two core promises. Out of scope by design. |

Other families (DeepSeek-Coder, Codestral) are reasonable too; Qwen stays the
base because it currently leads open agentic-coding and the setup is tuned for it.

### Agent: pi — vs Claude Code, Aider, Cursor, OpenHands

- **Why pi:** open-source, lightweight, and provider-agnostic — it speaks to
  any OpenAI-compatible endpoint, so pointing it at local Ollama is trivial.
  Small, transparent tool set (read/write/edit/bash) that's easy to reason
  about inside a sandbox.
- **Claude Code** is more capable but tied to Anthropic's cloud models (cost +
  data leaves the machine). It's not excluded though — you can sandbox it the
  same way: `nono run --allow . -- claude`. Best of both: local pi for the
  bulk, sandboxed Claude Code for the hard parts.
- **Aider** is a strong, mature local-friendly alternative — a fine substitute
  for pi. **Cursor** is an IDE, not a headless CLI you can wrap in a sandbox.
  **OpenHands** is more heavyweight (containerised agent platform).

### The underlying philosophy: a two-tier split

Cheap, private, local model for the **bulk** (mechanical edits, boilerplate,
exploration, anything touching private data); premium cloud model (Claude) for
the **hard reasoning** — sandboxed the same way when it runs locally. The
sandbox is what makes running *either* autonomously safe.

## How a run flows

1. I `cd` into a project and run `pi-safe`. It ensures the **router** is up
   (auto-spawning it on `:11500` if needed), then launches **nono**, which
   applies the `pi` Seatbelt profile and starts **pi** *inside* that sandbox.
2. **pi** sends each step to the router (`--model auto`). The router classifies
   it and forwards to **qwen3-coder-64k** (coder) or **qwen3.6-64k** (thinker)
   via **Ollama** on localhost, applying hysteresis + the thinker leash.
3. pi carries out the steps — but every file read/write and network call is
   policed by nono. Anything outside the allowed list is denied by the kernel.
   (`PI_NO_ROUTER=1 pi-safe` skips the router and uses the coder directly.)

## Config files (copies in `config/`, live locations below)

| Purpose | Lives at | Copy in repo |
|---|---|---|
| Sandbox security profile | `~/.config/nono/profiles/pi.json` | `config/nono-pi-profile.json` |
| pi provider wiring (`ollama` direct + `router`) | `~/.pi/agent/models.json` | `config/pi-models.json` |
| Launcher (auto-spawns router) | `/opt/homebrew/bin/pi-safe` | `config/pi-safe` |
| Model definition (64K context) | this repo | `Modelfile` |
| Router proxy (`:11500`) | runs from this repo | `router/` |

## What the sandbox allows vs denies

The `pi` profile extends nono's built-in `node-dev` → `default` profiles.

**Allowed:** read+write the folder you launch from; `~/.pi` (agent state);
read-only `~/.gitconfig`; Node/Homebrew toolchains; network via nono's
filtering proxy (dev domains like GitHub/npm) plus `localhost:11434` (Ollama) and
`localhost:11500` (the router). Verified 2026-06-14: opening `:11500` did **not**
widen file access — the canary test still denies SSH keys, `.zshrc`, Keychain.

**Denied (by the `default` base):** credential files, macOS Keychain, browser
data, shell history, shell config files (`.zshrc` etc.), dangerous commands,
and everything outside the allowed paths.

**Verified 2026-06-12:** a planted canary key in `~/.ssh` was denied
(`Operation not permitted`); `~/.zshrc` and `~/Library/Keychains` denied; the
working folder was writable; the air-gapped variant blocked GitHub while
keeping local Ollama.

## Commands cheat-sheet

```sh
# Daily use — sandboxed agent on the current folder, local model
pi-safe

# Sandbox ANY other agent the same way, e.g. Claude Code
nono run --allow . -- claude

# Fully air-gapped run (no network except local Ollama)
nono run --profile pi --allow-cwd --block-net --open-port 11434 -- \
  pi --provider ollama --model qwen3-coder-64k

# Inspect / debug the sandbox
nono profile show pi            # the resolved policy
nono why --profile pi --path ~/.ssh/id_ed25519 --op read   # would this be allowed?
nono audit                      # what did the last sandboxed run touch

# Model management
ollama list                                       # installed models
ollama create qwen3.6-64k -f Modelfile            # (re)build the thinker
printf 'FROM qwen3-coder:30b\nPARAMETER num_ctx 65536\n' | ollama create qwen3-coder-64k -f -   # the coder
# inside pi:  /model   to switch coder <-> thinker,  /exit   to quit

# Run the model eval (proves the coder/thinker split — see eval/)
cd eval && tsx run-eval.ts
```

## Verifying the sandbox

**The key lesson: test the boundary directly, not by asking the agent.** If you
tell the agent "read my SSH key," the *model* may simply refuse — which proves
nothing about the sandbox. The meaningful test runs the dangerous commands
*inside `nono run ...` with no model in the loop*, and confirms the **kernel**
denies them. That tests the actual security boundary regardless of whether the
agent cooperates.

```sh
# 1) Secrets & out-of-folder reads should ALL be denied ("Operation not permitted").
#    Plant a canary first so a denial means enforcement, not "file didn't exist".
echo "CANARY-$$" > ~/.ssh/canary_test && chmod 600 ~/.ssh/canary_test
cd ~/some-project
nono run --silent --profile pi --allow-cwd -- sh -c '
  cat  $HOME/.ssh/canary_test     # -> Operation not permitted
  cat  $HOME/.zshrc               # -> Operation not permitted
  ls   $HOME/Library/Keychains    # -> Operation not permitted
'
rm ~/.ssh/canary_test

# 2) The working folder SHOULD be writable (positive control).
nono run --silent --profile pi --allow-cwd -- sh -c 'echo ok > probe.txt && cat probe.txt'

# 3) Network posture. Default mode: localhost Ollama works, other hosts go
#    through nono's filter. Air-gapped mode: only localhost survives.
nono run --silent --profile pi --allow-cwd --block-net --open-port 11434 -- sh -c '
  curl -s --max-time 5 http://localhost:11434/api/version   # -> {"version":...}
  curl -s --max-time 5 https://api.github.com               # -> blocked / empty
'

# Also useful — ask nono directly, no run needed:
nono why --profile pi --path ~/.ssh/id_ed25519 --op read   # -> DENIED + reason
```

Run this whenever you change the profile — a wrong edit can silently widen
access, and "Operation not permitted" on the canary is your proof it didn't.

## Hardware notes

Runs on Apple Silicon with 48GB+ unified memory. One model is resident at a time
(`/model` swaps them): the coder `qwen3-coder-64k` loads to ~24GB at 64K (very
comfortable); the thinker `qwen3.6-64k` to ~28GB (fits with room for the OS, but
close heavy apps for big thinker runs). If memory gets tight on the thinker, drop
`num_ctx` or stay on the coder. More RAM (64GB+) would open up larger models like
Qwen3-Coder-Next (80B MoE). Measured speeds: coder ~43 tok/s, thinker ~20 tok/s.
