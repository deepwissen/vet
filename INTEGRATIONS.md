# Integrating `vet` into CI/CD and local workflows

`vet` is built to be a gate: it exits **non-zero** when it finds something at or
above `--fail-on`, so any pipeline that respects exit codes can enforce it. It
can also emit **SARIF 2.1.0** for inline annotations. No service, no network —
analysis is local.

- Exit codes: `0` clean · `1` findings at/above `--fail-on` · `2` usage error.
- Scope: `vet` (staged) · `vet --since <ref>` (changed vs a ref) · `vet <paths>`.
- Noise control: commit a [`.vetignore`](./COMMANDS.md) and use inline `vet:allow`.

---

## GitHub Actions — the published action (easiest)

```yaml
name: vet
on: [pull_request]
permissions:
  contents: read
  security-events: write   # only needed for SARIF inline annotations
jobs:
  vet:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0     # needed so --since can diff against the PR base
      - uses: deepwissen/vet@v0.1.1
        with:
          fail-on: error     # any | error | warning
          # paths: "src/"    # optional; default = files changed vs the PR base
          # sarif: "false"   # disable code-scanning upload
```

By default it scans the PR diff (changed files vs the base), fails the job on
error-severity findings, and uploads SARIF so findings show inline on the PR.

## GitHub Actions — without the action (plain npx)

```yaml
      - run: npx -y @deepwissen/vet@latest --since origin/${{ github.base_ref }} --fail-on error
```

---

## GitLab CI

```yaml
vet:
  image: node:22-alpine
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
  before_script:
    - apk add --no-cache git
  script:
    # diff against the MR target branch
    - git fetch origin "$CI_MERGE_REQUEST_TARGET_BRANCH_NAME"
    - npx -y @deepwissen/vet@latest --since "origin/$CI_MERGE_REQUEST_TARGET_BRANCH_NAME" --fail-on error
```

## Any CI (CircleCI, Jenkins, Buildkite, Azure Pipelines, …)

The generic recipe is one line — Node available, then:

```bash
npx -y @deepwissen/vet@latest --since "$BASE_REF" --fail-on error
# or scan the whole checkout:
npx -y @deepwissen/vet@latest . --fail-on error
# machine output for a dashboard:
npx -y @deepwissen/vet@latest . --json > vet.json
```

The job fails automatically when `vet` exits non-zero. Produce `--sarif` and feed
it to whatever code-scanning ingestion your platform offers.

---

## Local pre-commit hooks

### `pre-commit` framework

```yaml
# .pre-commit-config.yaml
repos:
  - repo: https://github.com/deepwissen/vet
    rev: v0.1.0
    hooks:
      - id: vet
```

`pre-commit` passes the staged files to `vet`, which scans exactly those.

### husky (Node projects)

```sh
# .husky/pre-commit
npx @deepwissen/vet --fail-on error
```

### lefthook

```yaml
# lefthook.yml
pre-commit:
  commands:
    vet:
      run: npx @deepwissen/vet --fail-on error
```

### Raw git hook

```sh
# .git/hooks/pre-commit  (chmod +x)
#!/usr/bin/env sh
npx @deepwissen/vet --fail-on error
```

With no path arguments, `vet` scans **git-staged** changes — exactly what a
pre-commit hook wants.

---

## Picking `--fail-on`

- **pre-commit / PR gate:** `--fail-on error` — block on real exposures (hardcoded
  secrets, long-lived credentials), let warnings through for review.
- **hardened / release branches:** `--fail-on warning` — block on traps and risky
  configs too.
- **audit only (never fail):** run with `--json`/`--sarif`, ignore the exit code,
  and report.

---

## Dashboards & security platforms (SARIF / JSON)

`vet` has no server or proprietary API — it writes two standard interchange
formats, and whatever you want to feed consumes the file:

- **SARIF 2.1.0** (`--sarif`) — the universal static-analysis interchange format,
  understood by code-scanning UIs and ASPM aggregators.
- **JSON** (`--json`) — for custom dashboards, data pipelines, and ad-hoc queries.

```bash
vet . --sarif > vet.sarif     # for code-scanning / ASPM ingestion
vet . --json  > vet.json      # for custom dashboards / pipelines (pipe to jq, a DB, etc.)
```

### Where the output plugs in

| Target | How |
|---|---|
| **GitHub code scanning** | `--sarif` → `github/codeql-action/upload-sarif` (the `deepwissen/vet` Action does this automatically) |
| **GitLab** | publish `--sarif` as a SAST report artifact, or consume `--json` |
| **Azure DevOps** | `--sarif` via the *SARIF SAST Scans* extension |
| **ASPM / aggregator dashboards** (DefectDojo, ArmorCode, Apiiro, …) | upload `--sarif` — they ingest SARIF from many scanners, so vet findings sit next to your other tools. **Best fit for a single unified view.** |
| **SonarQube** | import as external issues (SARIF / generic import; support varies by version) |
| **Custom dashboard** (Grafana, Elastic, BigQuery, …) | `--json` → your datastore |

### How it works (the pattern)

```
vet . --sarif > vet.sarif
        │
        ▼
  one SARIF file  ──►  code-scanning UI (GitHub/GitLab/Azure)   → inline PR annotations
                 ──►  ASPM / aggregator (DefectDojo, ArmorCode) → unified dashboard
                 ──►  SonarQube external-issues import          → quality gate
```

There's no callback or integration SDK — the SARIF/JSON artifact is the whole
contract. Produce it in CI, hand it to the consumer's upload step.

### Using `vet` alongside Checkmarx / Veracode / Snyk

These are **scanners in their own right**, not SARIF aggregators — so you don't
route `vet` *through* them. Two patterns:

- **Aggregate alongside** (recommended): run your SAST tool **and** `vet` in CI,
  and let a layer above — GitHub/GitLab code scanning, or an ASPM like
  DefectDojo / ArmorCode — collect both SARIF streams into one view.
- **Import** (if supported): some platforms (e.g. **Checkmarx One**) can import
  external SARIF results via their results API — check your specific version.

`vet` is **complementary, not a replacement**: your SAST tool scans source code;
`vet` covers the AI-agent layer it isn't built for — secrets about to enter an
agent's context, trap files, risky MCP/tool configs, and prompt-injection in
instruction files. The integration goal is to add vet's signal *next to* your
existing scanners in one dashboard, via SARIF.
