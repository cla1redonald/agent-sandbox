# Local Agentic AI Sandbox

**Run AI coding agents on a local model (nothing leaves the machine, zero API
cost), wrapped in a kernel-level sandbox so a misbehaving agent can only touch
the folder you point it at — not your SSH keys, passwords, or anything else.**

New here? Read **[ARCHITECTURE.md](ARCHITECTURE.md)** for how it all fits
together (with a diagram) and why. This README is the day-to-day usage guide.

Built following
[Willem van den Ende's local agentic dev setup](https://willemvandenende.com/blog/engineering/my-local-agentic-dev-setup-today),
adapted for an Apple Silicon Mac (48GB+ unified memory) — Ollama instead of
llama.cpp. Set up 2026-06-12. On 2026-06-13 a second model was added — a
*thinker* (Qwen3.6) alongside the fast *coder* (Qwen3-Coder) — after a
head-to-head eval ([eval/](eval/)) showed each wins a different class of task.
See [ARCHITECTURE.md](ARCHITECTURE.md#model-two-models-the-coder-and-the-thinker)
for the split and which alternatives were rejected.

## The stack

| Piece | What | Where |
|---|---|---|
| [nono](https://nono.sh) 0.62 | Kernel-level (Seatbelt) capability sandbox for agents | `brew install nono` |
| Ollama 0.24 | Local inference, OpenAI-compatible API on `localhost:11434` | already installed |
| `qwen3-coder-64k` | **The coder** (fast default) — Qwen3-Coder 30B-A3B, 64K ctx | built from `Modelfile` |
| `qwen3.6-64k` | **The thinker** (hard reasoning) — Qwen3.6 35B-A3B, 64K ctx | built from `Modelfile` |
| [pi](https://pi.dev) 0.79 | Coding agent CLI, pointed at Ollama | `npm i -g --ignore-scripts @earendil-works/pi-coding-agent` |

## Daily use

```sh
cd <your-project>
pi-safe                  # /opt/homebrew/bin/pi-safe:
                         # nono run --profile pi --allow-cwd -- pi --provider ollama --model qwen3-coder-64k
```

Starts on the fast **coder**. Inside pi, `/model` switches to `qwen3.6-64k` (the
**thinker**) or `qwen2.5:32b` (smaller fallback). All inference is local — zero
API cost, nothing leaves the machine.

### Which model when

The eval ([eval/RESULTS.md](eval/RESULTS.md)) measured where each one wins:

| Use | Model | Why |
|---|---|---|
| Bulk/agentic coding, edits, loops, anything simple | **`qwen3-coder-64k`** (coder) | ~2× faster, 0 timeouts, nails coding + format constraints |
| Hard multi-step reasoning, logic/math, tricky problems | **`qwen3.6-64k`** (thinker) | uniquely solves the reasoning traps the coder fails — but slower & verbose |
| Local reasoning over sensitive data | **`qwen3.6-64k`** (thinker) | strongest reasoning, and it never leaves the machine |

Rule of thumb: **default to the coder; reach for the thinker only when a task
genuinely needs deep reasoning.** The thinker is 2× slower, ~19× more verbose,
and can run away — don't use it for routine work. (Automating this choice is the
[router](docs/router-spec.md), greenlit by the eval but not yet built.)

New here? Try the 5-minute worked example:
**[examples/vault-linter](examples/vault-linter)** — have the sandboxed agent
build a small tool, then verify its output against known answers.

Sandbox **any other agent** the same way, e.g. Claude Code:

```sh
nono run --allow . -- claude
```

## What the sandbox enforces

Profile: `~/.config/nono/profiles/pi.json`, extends nono's built-in
`node-dev` → `default`, which **denies**: credentials files, macOS Keychain,
browser data, shell history, shell configs (`.zshrc` etc.), dangerous commands.
It **allows**: read+write to the working directory you launch from, `~/.pi`
(agent state), Homebrew/node toolchains, read-only `~/.gitconfig`.

Network goes through nono's filtering proxy (the `developer` network profile
from `node-dev` — npm registries etc.), plus `localhost:11434` for Ollama,
added in the profile's `network` section. For a fully air-gapped agent run:

```sh
nono run --profile pi --allow-cwd --block-net --open-port 11434 -- pi
```

(blocks all outbound network except localhost Ollama).

Verified working 2026-06-12: pi created/read files in the workdir via the
local model, while reads of `~/.zshrc`, `~/AGENTS.md`, and
`~/Library/Keychains` were denied (EPERM) by Seatbelt.

Useful nono commands: `nono audit` (what did the agent touch),
`nono why <path>` (would this be allowed), `nono rollback` (snapshot restore),
`nono profile show pi` (resolved policy).

## Config files

- `~/.config/nono/profiles/pi.json` — sandbox profile
- `~/.pi/agent/models.json` — pi → Ollama provider config
- `./Modelfile` — rebuilds the 64K-context **thinker**: `ollama create qwen3.6-64k -f Modelfile`. The header comments also show the one-liner that builds the **coder** (`qwen3-coder-64k`).

## Memory budget

Only one model is resident at a time (`/model` swaps them):

- **coder** `qwen3-coder-64k` ≈ 18GB weights, ~24GB loaded at 64K — very comfortable on 48GB.
- **thinker** `qwen3.6-64k` ≈ 23GB weights, ~28GB loaded at 64K — fits with room for the OS, but tighter, so close heavy apps for big thinker runs.

If you hit memory pressure on the thinker, drop `num_ctx` in `Modelfile` and
re-run `ollama create`, or just stay on the coder. 128K context is not a safe
default for the thinker on 48GB.
