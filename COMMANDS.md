# `vet` — Command Reference

`vet` is a local, pre-PR security gate. It is **detect-and-explain only**: nothing
is modified and nothing is sent anywhere.

**Exit codes:** `0` clean · `1` findings at/above `--fail-on` · `2` usage/error.

## Commands — what to scan

| Command | What it does |
|---|---|
| `vet` | Scan **git staged** changes (default — the pre-commit use case) |
| `vet <paths...>` | Scan specific files/dirs, e.g. `vet src/ config.json` |
| `vet --since <ref>` | Scan files changed since a git ref, e.g. `vet --since main` (pre-PR use case) |

## Output modes

| Flag | Use |
|---|---|
| *(none)* | Human-readable grouped report (default) |
| `--json` | Machine-readable findings — pipe to `jq`, dashboards |
| `--sarif` | SARIF 2.1.0 → GitHub code scanning inline PR annotations |

## Gate & misc

| Flag | Use |
|---|---|
| `--fail-on any\|error\|warning` | Severity that trips exit `1` (default `error`) |
| `--ignore-file <path>` | Use a specific allowlist (default: `.vetignore`) |
| `--no-ignore` | Bypass `.vetignore` — scan everything (audit mode) |
| `-q, --quiet` | Suppress output when there are no findings |
| `--no-color` | Disable ANSI color |
| `-v, --version` | Print version |
| `-h, --help` | Print help |

## Feature by feature (what each detector catches)

```bash
# Secrets — AWS/GitHub/etc. keys, high-entropy strings, connection strings, JWTs
vet src/config.ts
#   const k = "AKIA<redacted-example-key>";  → ERROR  aws-access-key (long-lived credential)

# Trap files — unsafe deserialization / data traps
vet ml/loader.py
#   pickle.load(...)  → WARNING  trap-unsafe-deserialization

# Instruction integrity — prompt injection / hidden-unicode / bidi
# in CLAUDE.md, .cursorrules, copilot-instructions.md, etc.
vet CLAUDE.md
#   "Ignore all previous instructions…"  → suspicious-instruction

# MCP hygiene — secrets in config, unpinned servers, risky tool grants
vet .mcp.json
#   unpinned "npx -y @vendor/mcp"  → mcp-unpinned-server

# Agent autonomy (OWASP LLM06) — can an agent act without a human in the loop?
vet .claude/settings.json
#   permissions.allow: ["Bash(*)"]  → ERROR  agent-broad-command-allow
vet package.json
#   "claude --dangerously-skip-permissions"  → ERROR  agent-skip-permissions
```

The **agent** category inspects agent config across Claude Code, MCP, Cline/Roo,
Aider, Codex, and Continue. Errors (block by default): `agent-skip-permissions`,
`agent-broad-command-allow`, `agent-auto-approve-exec`, `mcp-always-allow` (`*`).
Warnings: `agent-auto-approve-write`, `agent-auto-run-hook`, `agent-enable-all-mcp`.
Scoped allows (`Bash(git:*)`, `Read(*)`) and `false` values are never flagged.

## Typical wiring

```bash
# pre-commit hook — block the commit on any finding
vet || exit 1

# CI pre-PR gate — block only on errors, feed GitHub code scanning
vet --since origin/main --fail-on error --sarif > vet.sarif
```

## Allowlist — `.vetignore`

Benign, structural matches (test fixtures, doc examples, config files) can be
suppressed with a `.vetignore` file at the directory you run `vet` from. It uses
a documented subset of gitignore syntax; ignored files are skipped **before**
scanning, and the count is always surfaced (never silently dropped).

```gitignore
# .vetignore
test/                      # directory-only: ignores everything under test/
*.md                       # bare glob: matches at any depth
.gitleaks.toml             # a specific file
src/generated/**           # anchored (contains a slash) + ** across segments
!test/real-scan.test.ts    # negation: re-include (last matching rule wins)
```

Supported: `#` comments · blank lines · `!` negation (last match wins) ·
trailing `/` (directory-only) · leading `/` or an internal `/` (anchored to root)
· bare name (matches at any depth) · `*` (within a segment) · `**` (across
segments) · `?` (one character).

```bash
vet .                      # respects ./.vetignore; prints "N skipped by .vetignore"
vet . --no-ignore          # ignore the allowlist, scan everything
vet . --ignore-file ci.vetignore
```

### Inline suppression — `vet:allow`

For a single line (where a path glob would be too broad — e.g. an example key in
a doc, or a detector's own source), use an inline directive. It is matched
anywhere on the line, so it works inside any comment syntax.

```ts
const k = "AKIA…";   // vet:allow                         (suppress any rule on this line)
const k = "AKIA…";   // vet:allow aws-access-key, trap-x  (only these rules)
const k = "AKIA…";   // vet:allow aws-access-key -- documented example   (reason after --)
// vet:allow-next-line aws-access-key
const k = "AKIA…";                                         (suppress the line below)
```

Suppressed findings are counted and surfaced (`findingsSuppressed` in JSON,
`(N suppressed by vet:allow)` in human output). `--no-ignore` bypasses **both**
`.vetignore` and inline directives for a true-everything audit.

## Related

- **`ai-preflight`** — the VS Code extension built on the same detection engine,
  adding live in-IDE context/token/waste analysis. See that repo's `COMMANDS.md`.
- **`@deepwissen/preflight-core`** — the shared detection engine (a library, no
  commands) that both `vet` and `ai-preflight` consume.
