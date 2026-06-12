# Vault Linter — build brief

Paste the prompt below into `pi-safe` when run from this folder. It asks the
sandboxed local agent to build an Obsidian "vault linter" CLI, then verify it
against `sample-vault/` — whose problems are known in advance (below).

## Known issues planted in `sample-vault/` (so you can verify the linter works)

| File | Problem(s) it should catch |
|---|---|
| `welcome.md` | clean — should pass |
| `meeting-notes.md` | broken link `[[nonexistent-note]]` |
| `stray-idea.md` | **no frontmatter**, broken link `[[also-missing]]`, **orphan** |
| `old-archive.md` | **stale** (created 2024-01-15), **orphan** |

A correct linter should report: **2 broken links, 1 missing-frontmatter,
2 orphans, 1 stale note.**

## Prompt to paste into pi-safe

> Build a TypeScript CLI called `vault-lint` in this directory that scans a folder
> of Obsidian markdown notes and reports problems. It must detect:
> 1. Broken `[[wikilinks]]` — links pointing to notes that don't exist in the folder.
> 2. Notes missing YAML frontmatter (no `---` block at the top).
> 3. Orphan notes — notes that no other note links to.
> 4. Stale notes — `created:` date older than 6 months.
>
> Usage: `vault-lint ./sample-vault`. Print a clear grouped report with counts.
> Write unit tests and run them. Run the tool against ./sample-vault and show the output.
> Use only Node's standard library plus a tiny YAML parse if needed — keep dependencies minimal.
