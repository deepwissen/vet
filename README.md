# vet

**Scan what your AI agent is about to touch — before you open the PR.**

`vet` is a local, pre-PR security gate for AI-assisted development. It inspects your
changed files for the things that bite agentic workflows:

- 🔑 **Secrets** — hardcoded credentials, with a louder flag for **long-lived / non-expiring** ones
- 🪤 **Trap files** — *safe to read, not safe to auto-process*: unsafe deserialization
  (`pickle`/`torch`/`yaml.load`…) and data-file traps (template expressions, external
  `reference://` payloads)
- 🧩 **Tool-config risk** — MCP configs with embedded secrets, prompt-injected tool
  descriptions, over-broad auto-approve grants, or unpinned (supply-chain-risky) servers
- 📏 **Instruction-file integrity** — hidden unicode, bidi overrides, prompt injection in
  `CLAUDE.md` / `.cursorrules` / copilot instructions

All analysis is **local and detect-and-explain only** — `vet` never modifies your files
and never sends anything anywhere. It's the same engine behind the
[AI Preflight](https://github.com/deepwissen/ai-preflight) VS Code extension
([`@deepwissen/preflight-core`](https://github.com/deepwissen/preflight-core)).

## Install
```bash
npx @deepwissen/vet            # run without installing
npm i -g @deepwissen/vet       # or install the `vet` command
```

## Usage
```bash
vet                    # scan git staged changes (default)
vet --since main       # scan files changed since a ref
vet src/ config/       # scan specific files/dirs
vet --json             # machine-readable JSON
vet --sarif            # SARIF 2.1.0 → GitHub code scanning annotations
vet --fail-on error    # only fail the build on errors (default: any finding)
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
