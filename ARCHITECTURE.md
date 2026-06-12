# Architecture — Local Agentic AI Sandbox

This documents how my local agentic coding setup works, so I (or anyone) can
understand and explain it. Set up 2026-06-12, inspired by
[Willem van den Ende's local agentic dev setup](https://willemvandenende.com/blog/engineering/my-local-agentic-dev-setup-today),
adapted for my machine.

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
│   │  │  Ollama  →  qwen3-coder-64k           │      │     │
│   │  │  Local inference on localhost:11434   │      │     │
│   │  └──────────────────────────────────────┘      │     │
│   └───────────────────────────────────────────────┘     │
│                                                          │
│  Allowed: the working folder, ~/.pi, localhost Ollama    │
│  Denied:  SSH keys, Keychain, ~/.zshrc, browser data,    │
│           shell history, everything outside the folder   │
└─────────────────────────────────────────────────────────┘
```

| Piece | Role | What it is |
|---|---|---|
| **nono** 0.62 | The sandbox. Enforces what the agent can touch, at the kernel level. | `brew install nono`. Uses macOS Seatbelt; the policy is irrevocable once applied. |
| **Ollama** 0.24 | Runs the model locally, exposes an OpenAI-compatible API on `localhost:11434`. | Already installed. |
| **qwen3-coder-64k** | The model — Qwen3-Coder 30B-A3B (mixture-of-experts, ~3.3B active), given a 64K context window. | Built from `Modelfile` here. ~18GB. |
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

### Model: Qwen3-Coder 30B-A3B — vs dense models, smaller/bigger, other families

- **Why this one:** it's a *mixture-of-experts* model — 30B total parameters
  but only ~3.3B active per token — so it runs fast and light on 48GB while
  punching well above its memory footprint. It's tuned for *agentic* coding
  (tool use, multi-step edits), natively handles very long context, and the
  weights are open.
- **A dense 30B** (e.g. Qwen2.5 32B, also installed here as a fallback) is
  often a touch stronger per-token but slower and heavier in memory for similar
  quality — the MoE wins on speed-per-GB.
- **Smaller models** (7–8B, like the llama3.1:8b kept here) are faster and fine
  for trivial edits but noticeably weaker at multi-step agent work.
- **Bigger models** (70B+) are better but need far more RAM than 48GB allows at
  a usable speed.
- **Other families** (DeepSeek-Coder, Codestral, etc.) are reasonable
  alternatives; Qwen3-Coder currently leads open agentic-coding benchmarks,
  which is why it's the default.

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

1. I `cd` into a project and run `pi-safe`.
2. `pi-safe` launches **nono**, which applies the `pi` security profile (a
   Seatbelt sandbox) and then starts **pi** *inside* that sandbox.
3. **pi** reads my task, and for each step asks **qwen3-coder-64k** (via
   **Ollama** on localhost) what to do.
4. pi carries out the steps — but every file read/write and network call is
   policed by nono. Anything outside the allowed list is denied by the kernel.

## Config files (copies in `config/`, live locations below)

| Purpose | Lives at | Copy in repo |
|---|---|---|
| Sandbox security profile | `~/.config/nono/profiles/pi.json` | `config/nono-pi-profile.json` |
| pi → Ollama provider wiring | `~/.pi/agent/models.json` | `config/pi-models.json` |
| Launcher script | `/opt/homebrew/bin/pi-safe` | `config/pi-safe` |
| Model definition (64K context) | this repo | `Modelfile` |

## What the sandbox allows vs denies

The `pi` profile extends nono's built-in `node-dev` → `default` profiles.

**Allowed:** read+write the folder you launch from; `~/.pi` (agent state);
read-only `~/.gitconfig`; Node/Homebrew toolchains; network via nono's
filtering proxy (dev domains like GitHub/npm) plus `localhost:11434` for Ollama.

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
ollama create qwen3-coder-64k -f Modelfile        # rebuild the 64K variant
# inside pi:  /model   to switch models,  /exit   to quit
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

Runs on Apple Silicon with 48GB+ unified memory. `qwen3-coder-64k` ≈ 18GB
weights + ~6GB KV cache at 64K context — comfortable, with room for the OS and
a browser. More RAM lets you raise `num_ctx` or run larger models.
