# Example: build a vault linter in the sandbox

A 5-minute worked example of using the sandbox for real. You ask the local
agent to build a small tool, and you **verify it against known answers** rather
than trusting its word — the verification habit this whole repo is about.

It builds an Obsidian "vault linter": a CLI that scans a folder of markdown
notes and flags broken `[[wikilinks]]`, notes missing frontmatter, orphan
notes, and stale notes.

## Run it

```sh
cd examples/vault-linter
pi-safe
```

Then paste the build prompt from [`BRIEF.md`](BRIEF.md) and press Enter. Watch
the agent write the tool, write tests, run them, and run the tool against
`sample-vault/`. (First response is slow while the model loads; after that it's
quick. Everything is sandboxed to this folder.)

## How you know it worked

`sample-vault/` contains four notes with **deliberately planted** problems, so
correct output is known in advance:

| File | Planted problem(s) |
|---|---|
| `welcome.md` | clean — should pass |
| `meeting-notes.md` | broken link `[[nonexistent-note]]` |
| `stray-idea.md` | no frontmatter · broken link `[[also-missing]]` · orphan |
| `old-archive.md` | stale (dated 2024) · orphan |

A correct linter reports exactly:

```
Broken links:        2   (meeting-notes → nonexistent-note, stray-idea → also-missing)
Missing frontmatter: 1   (stray-idea.md)
Orphan notes:        2   (stray-idea.md, old-archive.md)
Stale notes:         1   (old-archive.md)
```

If the numbers match, the tool is genuinely correct. If they don't, that's a
useful drive too — tell the agent which it missed and watch it fix itself.

## Why this matters

This is the repo's core lesson in miniature: a green run, passing tests, and
confident-sounding output can all be true while the code is subtly wrong. The
only proof is checking real output against answers you already know. Keep a
small fixture with planted problems and you can trust the result.

> Note: the linter *code* the agent produces is not committed here — it's
> unreviewed local-model output and incidental to this repo. This example gives
> you the fixture and the brief so you can reproduce the build yourself.
