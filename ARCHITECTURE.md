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

## Machine

Apple M4 Pro, 48GB unified memory. `qwen3-coder-64k` ≈ 18GB weights + ~6GB KV
cache at 64K context — comfortable, with room for the OS and a browser.
