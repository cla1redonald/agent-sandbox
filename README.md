# Local Agentic AI Sandbox

Safe local setup for running coding agents, following
[Willem van den Ende's local agentic dev setup](https://willemvandenende.com/blog/engineering/my-local-agentic-dev-setup-today),
adapted for this machine (M4 Pro, 48GB) — Ollama instead of llama.cpp.

Set up 2026-06-12.

## The stack

| Piece | What | Where |
|---|---|---|
| [nono](https://nono.sh) 0.62 | Kernel-level (Seatbelt) capability sandbox for agents | `brew install nono` |
| Ollama 0.24 | Local inference, OpenAI-compatible API on `localhost:11434` | already installed |
| `qwen3-coder-64k` | Qwen3-Coder 30B-A3B (MoE, 3.3B active) with 64K context | built from `Modelfile` here |
| [pi](https://pi.dev) 0.79 | Coding agent CLI, pointed at Ollama | `npm i -g --ignore-scripts @earendil-works/pi-coding-agent` |

## Daily use

```sh
cd <your-project>
pi-safe                  # /opt/homebrew/bin/pi-safe:
                         # nono run --profile pi --allow-cwd -- pi --provider ollama --model qwen3-coder-64k
```

Inside pi, `/model` to switch between `qwen3-coder-64k` (default coder) and
`qwen2.5:32b`. All inference is local — zero API cost, nothing leaves the machine.

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
- `./Modelfile` — rebuilds the 64K-context model: `ollama create qwen3-coder-64k -f Modelfile`

## Memory budget (48GB)

`qwen3-coder-64k` ≈ 18GB weights + ~6GB KV cache at 64K — comfortable.
To try a bigger context, edit `num_ctx` in `Modelfile` and re-run
`ollama create`; 128K will still fit but leaves less headroom for the OS.
