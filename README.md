# vet

**Scan what your AI agent is about to touch — before you open the PR.**

![vet in action](demo/vet-demo.gif)

`vet` is a local, pre-PR security gate for AI-assisted development. It inspects your
changed files for the things that bite agentic workflows:

- 🔑 **Secrets** — hardcoded credentials, with a louder flag for **long-lived / non-expiring** ones
- 🪤 **Trap files** — *safe to read, not safe to auto-process*: unsafe deserialization
  (`pickle`/`torch`/`yaml.load`…) and data-file traps (template expressions, external
  `reference://` payloads)
- 🤖 **Excessive agency** (OWASP LLM06) — agent configs that let the AI act without you:
  `Bash(*)`, `--dangerously-skip-permissions`, auto-approve-execute, across Claude Code,
  MCP, Cline/Roo, Aider, Codex, Continue
- 🧩 **Tool-config risk** — MCP configs with embedded secrets, prompt-injected tool
  descriptions, over-broad auto-approve grants, or unpinned (supply-chain-risky) servers
- 📏 **Instruction-file integrity** — hidden unicode, bidi overrides, prompt injection,
  LLM role-tag spoofing in `CLAUDE.md` / `.cursorrules` / copilot instructions / prompt files

All analysis is **local and detect-and-explain only** — `vet` never modifies your files
and never sends anything anywhere. It's the same engine behind the
[AI Preflight](https://github.com/deepwissen/ai-preflight) VS Code extension
([`@deepwissen/preflight-core`](https://github.com/deepwissen/preflight-core)).

## Install
```bash
npx @deepwissen/vet            # run without installing
npm i -g @deepwissen/vet       # or install the `vet` command
```

The detection rules live in `@deepwissen/preflight-core`, pulled in automatically.
`vet --version` shows both so you can confirm which engine you're on:
```bash
$ vet --version
0.1.5 (engine @deepwissen/preflight-core 0.1.8)
```

> **Getting an old version from `npx`?** npx caches installs and may reuse a stale
> one even with `@latest`. Pin the exact version `npx @deepwissen/vet@0.1.5`, or
> `npx --ignore-existing @deepwissen/vet`, or clear the cache with
> `rm -rf ~/.npm/_npx`. Run `vet --version` to confirm the engine version updated.

## Usage
```bash
vet                    # scan git staged changes (default)
vet --since main       # scan files changed since a ref
vet src/ config/       # scan specific files/dirs
vet --json             # machine-readable JSON
vet --sarif            # SARIF 2.1.0 → GitHub code scanning annotations
vet --fail-on any      # fail on any finding (default: error — real exposures only)
```

**Exit codes:** `0` clean · `1` findings at/above `--fail-on` · `2` usage/error.

## In CI (fail the PR on findings)
```yaml
- run: npx @deepwissen/vet --since origin/main --sarif > vet.sarif
- uses: github/codeql-action/upload-sarif@v3
  with: { sarif_file: vet.sarif }
```

## Pre-commit hook
```sh
# .husky/pre-commit
npx @deepwissen/vet --staged --fail-on any
```
