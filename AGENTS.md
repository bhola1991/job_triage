# Job Triage — guidance for Codex

**The project rules live in [`CLAUDE.md`](CLAUDE.md). Read that file.** It is the
single copy: the palette and its two-palette trap (§0), tokens (§1), the
component library (§2), the three runtimes (§3), assets (§4), icons (§5),
styling (§6), the project map (§7), the verification harness (§8), and the Parse
and Mantiks integrations (§9, §10).

## Why this file is a pointer and not a copy

It used to be a copy — all 651 lines of it, with `.claude/` mechanically
rewritten to `.Codex/`. By 2026-10-08 it had drifted by 36 lines: it was missing
`src/reply-match.mjs`, `src/mime-lite.mjs`, `scripts/selfcheck-reply.js`,
`scripts/selfcheck-worker.js`, `scripts/read-feedback.js`,
`scripts/tune-flag-thresholds.js`, `scripts/record-eval.ts` and both
`scripts/eval/` data files, and it still described `index.html` as ~4,670 lines
when it had reached 6,748.

The only content that was ever genuinely its own was a section about Codex
configuration, and every claim in it was wrong — see below. So two copies of the
project's law were being maintained by hand, one of them silently stale, in a
repository whose own guidance (§1, §7) is that a value transcribed by hand into
a second place drifts and needs a check to catch it. The same week, the code
carried a dedup key spelled two ways that disagreed, and a price list that
promised a scraper deleted five days earlier. A pointer cannot drift.

If something here needs to differ for Codex, write **only the difference**, below.

## Codex-specific: what is actually on disk

`.codex/config.toml` — **untracked, machine-local, and correct to be.** It
declares two MCP servers:

```toml
[mcp_servers.parse]
url = "https://api.parse.bot/mcp"

[mcp_servers.x]
url = "https://api.x.com/mcp"
```

This matches the rule CLAUDE.md §9 states for the Claude side: MCP registration
is per-machine and must not be committed, because a committed config reaches
everyone who clones. `.claude/settings.json` is tracked and is kept to plugin
declarations only for exactly that reason; `.codex/config.toml` holds server
URLs, so it stays out of git. `.gitignore` names `.codex/` so it is ignored
deliberately rather than showing up as untracked noise.

### What the old version of this file claimed, and why none of it held

It described `.Codex/settings.json` as "tracked on purpose", declaring the
`typesafe-ai` marketplace, with `.gitignore` naming `.Codex/*.local.json` and
`.Codex/launch.json` as per-machine. Checked on 2026-10-08:

- the directory is `.codex`, lowercase — `.Codex` has never existed
- the file is `config.toml`, not `settings.json`, and TOML, not JSON
- it is **untracked**, not tracked on purpose
- it declares MCP servers, not a plugin marketplace
- `.gitignore` mentioned nothing about codex at all

It was a search-and-replace of the Claude section that was never checked against
the disk. Anything written here from now on is worth checking the same way, with
`ls` and `git ls-files`, before it is written down.
