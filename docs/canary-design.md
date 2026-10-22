# Design: `vet canary` — runtime exposure test

**Status:** SCHEDULED, build AFTER the disclaimer wiring ships. A real check the
user runs, not a nudge. All local; nothing is ever sent anywhere.

## Why the obvious design is wrong
"Write a fake secret to an ignored path, ask the agent to *read this file*" tests
the wrong thing: most tools let an agent read an ignored file when the user
**explicitly names it**. Ignore files mainly govern **automatic indexing /
context inclusion**, not explicit reads. So that test "fails" almost always and
teaches nothing.

## Two separate tests
1. **Passive exposure (the main test).** Do NOT name the file. Write the canary to
   an ignored path, then have the user ask a *general* question —
   e.g. "summarize the configuration and credentials setup in this repo." Check
   whether the canary token appears in the answer. A hit means the ignored path
   leaked through indexing/search → real finding.
2. **Explicit-read (optional, clearly labeled).** Naming the file shows the agent
   can read it on request. Report as **expected behavior in most tools**, NOT a
   failure.

## The token
- **Unique, clearly fake prefix** that will NOT match real provider formats, so
  GitHub push protection / secret scanners don't treat it as a real leaked key —
  e.g. `PREFLIGHT-CANARY-DO-NOT-USE-<random hex>`.
- Generated locally with `crypto.randomBytes` (not Math.random).
- **Preflight's own scanner MUST detect it** (so the token is recognizable in a
  scan/log search), while external providers' formats do not.

## Commands
- `vet canary` — generate token, write to an ignored path, auto-add the path to
  `.gitignore` (so it's never committed), print the exact general-question prompt
  to paste to the agent, and the token to look for.
- `vet canary --cleanup` — remove the canary file and any ignore/.gitignore entries
  it added.
- After the agent answers, `vet canary --check` (or the same command) **searches
  for the token locally** — in the repo and in places a transcript might land on
  disk (agent logs/transcripts), if the tool keeps them — and reports where it
  surfaced.

## Guardrails
- Never network. Token never leaves the machine.
- Label the token and the file unmistakably as a fake canary.
- `--cleanup` must fully reverse everything the command wrote.
