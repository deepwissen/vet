# vet secret-detection benchmark

Scores vet's **secret** findings against labeled datasets and runs gitleaks on the same files for comparison.

The benchmark covers secrets only. gitleaks doesn't check instruction-file integrity, MCP config hygiene or agent permissions, so there's nothing to compare those against. Those checks need their own labeled corpus.

## Quick start

```bash
npm ci
npm run bench:test          # unit tests for the scoring code
npm run bench:sample        # generate a labeled sample corpus and score vet vs gitleaks
```

gitleaks is read from `PATH`, from `GITLEAKS_BIN`, or from `--gitleaks <path>`. To run vet alone, use `--tools vet`.

Results are written to `bench/results/results.{json,md,html}`. The JSON is meant for diffing between runs.

## Datasets

| Dataset | Format flag | What it is |
|---|---|---|
| Generated sample | `jsonl` | `bench/sample/make-sample.mjs`. Correctly shaped but random secrets for 16 providers, plus common decoys (AWS docs example keys, placeholders, env-var references, hashes, UUIDs, lockfile integrity strings, publishable keys). Use it as a smoke test, not as evidence: the same person wrote the corpus and the scanner. |
| [Samsung CredData](https://github.com/Samsung/CredData) | `creddata` | About 300 public repos pinned to fixed commits. Every candidate line was reviewed by hand, and real credentials were replaced with fake values of the same shape. `GroundTruth` is T (real), F (false) or X (template, scored as not-a-secret). |
| [SecretBench](https://github.com/setu1421/SecretBench) | `secretbench` | 818 repos and 97,479 labeled candidates. Access is on request because it contains real leaked secrets. Export the BigQuery table to CSV and clone each repo into `corpus/<owner>/<repo>`. |

### CredData

```bash
git clone https://github.com/Samsung/CredData && cd CredData
pip install -r requirements.txt
python download_data.py --data_dir data --jobs 12     # clones 337 repos (~8 GB in tmp/), ~5–10 min
cd -
# Labels say "data/<repo>/…". Give the dataset its own folder so the scanners
# don't also read CredData's scripts and meta CSVs:
mkdir -p ../cdc && mv ../CredData/data ../cdc/data

# Each tool on its own defaults:
node bench/run.mjs --corpus ../cdc --labels ../CredData/meta --labels-format creddata --dataset CredData
# Like for like, on the files vet actually reads:
node bench/run.mjs --corpus ../cdc --labels ../CredData/meta --labels-format creddata --dataset "CredData (same files)" --vet-scope
```

Both tools take under a minute on CredData's ~11,500 files.

### Your own labels (`jsonl`)

One object per line, with `file` relative to the corpus:

```json
{"file":"src/app.py","line":12,"truth":true,"type":"aws-access-key"}
{"file":"certs/server.key","line":1,"endLine":27,"truth":true,"type":"private-key"}
{"file":"docs/setup.md","line":8,"truth":false,"type":"placeholder"}
```

## How it scores

- **Recall** = real secrets with at least one finding on their line range ÷ all real secrets.
- **Precision** = findings on a real-secret line ÷ findings on any labeled line.
- **Precision (strict)** counts unlabeled findings as false too. Public datasets only label candidates their own regexes found, so a tool can be right about an unlabeled line. Report both numbers, and spot-check unlabeled findings before claiming either one.
- Findings are de-duplicated by `file:line`, so several rules firing on one line count once.
- `--tolerance n` accepts a finding within n lines of a labeled range. This helps when tools disagree about where a multi-line key starts.
- Labels whose file isn't in the corpus are dropped and counted. This matters for SecretBench, which mined every commit while both tools scan only the current working tree. Use `--keep-missing` to count those labels as misses instead.

The report lists **locations only**. Secret values are never read, and gitleaks runs with `--redact`.

## Making the comparison fair

- **Same files.** gitleaks runs as `gitleaks dir` (working tree, no git history) to match `vet <path>`. vet still reads fewer files than gitleaks:
  - If the corpus root is a git repo, vet scans only tracked files (`git ls-files`).
  - vet skips `node_modules`, `dist`, `build`, `out`, `coverage` and `.next`, files over 1 MB, and binaries.
  - preflight-core's secret scanner stops after **50 findings per file** (10 before 0.1.17) and does not report that it stopped. Before 0.1.17 it also returned nothing for files over 100,000 characters.

  Run once on each tool's defaults (what a user gets) and once with `--vet-scope` (detection quality on the same files). Publish both.
- **vet 0.1.9 cut off piped JSON at 64 KB** (fixed in 0.1.10). The harness still sends vet's stdout to a file, so older versions also work.
- **Dataset bias.** SecretBench candidates were mined with TruffleHog and gitleaks patterns. A secret that neither tool's patterns recognize can't be in the dataset, so recall slightly favors gitleaks. Mention this when publishing.
- **Hold-out set.** When tuning rules against a dataset, set aside about 20% of its repos and never look at them while tuning. Report numbers on that set.

## CI regression gate

```bash
node bench/run.mjs --corpus bench/.sample/corpus --labels bench/.sample/labels.jsonl \
  --tools vet --fail-under-recall 0.95 --fail-under-precision 0.90
```

This exits with code 1 if a rule change makes vet worse on the sample.

## Improvement loop

1. Run the benchmark.
2. Open `results.md` and read **False alarms by rule** and **Missed secrets**.
3. Fix the biggest category in `@deepwissen/preflight-core`, rebuild and rerun.
4. Diff `results.json` against the previous run, so a fix for one type doesn't quietly cost another.
