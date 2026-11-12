// bench:noise — false-alarm (noise) test on clean, popular repos vet was never
// tuned on. These projects hold ~no real secrets, so most secret findings are
// candidate false alarms. This measures what users feel first and CredData can't:
// noise on unfamiliar real code.
//
// Methodology (deliberately not flattering):
//   - Pinned, type-balanced repo list (bench/noise-repos.json): ~1/3 app, 1/3
//     sdk/infra, 1/3 docs. Pin SHAs with --pin so runs are comparable.
//   - Report TOTAL alerts/1k (what a user dismisses, shared-with-gitleaks or not)
//     AND vet-only vs gitleaks-only (what's specific to each tool's rules).
//   - Report the ABSOLUTE gap (extra alerts/1k), never a ratio — ratios over small
//     counts mislead.
//   - Report median per repo and a "without the noisiest repo" figure so one
//     outlier can't set the headline.
//   - "Clean repo" is an assumption, not a label. --emit-sample writes a sample to
//     hand-label (plain-noise / example / test-fixture / real); --labels reports
//     the split. Secret values are never written to any file.
//
// Usage:
//   node bench/noise.mjs                       # pinned list, vet (+ gitleaks if present)
//   node bench/noise.mjs --pin                 # lock each repo's current SHA into the config
//   node bench/noise.mjs --emit-sample 100     # write a sample to label
//   node bench/noise.mjs --labels bench/results/noise-sample.jsonl
//   node bench/noise.mjs --repos a=URL,b=URL   # ad-hoc override
//   node bench/noise.mjs --fail-over 15        # exit 1 if vet total alerts/1k > 15

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { runVet, runGitleaks, toolVersion } from "./lib/tools.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

const { values: a } = parseArgs({
  options: {
    repos: { type: "string" },
    config: { type: "string", default: join(HERE, "noise-repos.json") },
    tools: { type: "string", default: "vet,gitleaks" },
    cache: { type: "string", default: join(HERE, ".noise") },
    out: { type: "string", default: join(HERE, "results", "noise") },
    gitleaks: { type: "string", default: process.env.GITLEAKS_BIN ?? "gitleaks" },
    pin: { type: "boolean" },
    "emit-sample": { type: "string" },
    labels: { type: "string" },
    seed: { type: "string", default: "42" },
    "fail-over": { type: "string" },
  },
});

// ── repo list ──
let repoList;
if (a.repos) {
  repoList = a.repos.split(",").map((s) => {
    const [name, url] = s.includes("=") ? s.split("=") : [s.split("/").pop(), s];
    return { name: name.trim(), url: url.trim(), type: "app", sha: null };
  });
} else {
  repoList = JSON.parse(readFileSync(a.config, "utf8"));
}

const tools = new Set(a.tools.split(",").map((s) => s.trim()));
const hasGitleaks = tools.has("gitleaks") && toolVersion(a.gitleaks, ["version"]) !== "unknown";
mkdirSync(a.cache, { recursive: true });
mkdirSync(dirname(a.out), { recursive: true });

// ── labels-only mode: summarize a hand-labeled sample and exit ──
if (a.labels) {
  const rows = readFileSync(a.labels, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  const labelled = rows.filter((r) => r.label);
  const by = tally(labelled.map((r) => r.label));
  process.stdout.write(`# Labeled noise sample — ${labelled.length}/${rows.length} labeled\n\n`);
  for (const [k, n] of Object.entries(by))
    process.stdout.write(`- ${k}: ${n} (${((n / labelled.length) * 100).toFixed(0)}%)\n`);
  const realish = labelled.filter((r) => /real|fixture/.test(r.label)).length;
  process.stdout.write(
    `\n${realish} of ${labelled.length} are real / realistic test fixtures — i.e. NOT plain noise.\n`
  );
  process.exit(0);
}

/** Clone (pinned SHA if set, else shallow latest) or reuse. Returns {dir, sha} or null. */
function fetchRepo(r) {
  const dir = join(a.cache, r.name);
  if (!existsSync(join(dir, ".git"))) {
    process.stderr.write(`cloning ${r.name}… `);
    const cl = spawnSync("git", ["clone", "--filter=blob:none", "--quiet", r.url, dir], {
      encoding: "utf8",
    });
    if (cl.status !== 0) {
      process.stderr.write(`FAILED\n`);
      return null;
    }
    process.stderr.write("ok\n");
  }
  if (r.sha) spawnSync("git", ["-C", dir, "checkout", "--quiet", r.sha], { encoding: "utf8" });
  const sha = spawnSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout?.trim();
  return { dir, sha };
}

function norm(file, dir) {
  const f = file.replace(/\\/g, "/");
  for (const d of [resolve(dir).replace(/\\/g, "/") + "/", dir.replace(/\\/g, "/") + "/"])
    if (f.startsWith(d)) return f.slice(d.length);
  return f;
}
function tally(arr) {
  const m = {};
  for (const x of arr) m[x] = (m[x] ?? 0) + 1;
  return Object.fromEntries(Object.entries(m).sort((x, y) => y[1] - x[1]));
}
function median(xs) {
  if (!xs.length) return 0;
  const s = [...xs].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const rows = [];
for (const r of repoList) {
  const got = fetchRepo(r);
  if (!got) {
    rows.push({ ...r, error: "clone failed" });
    continue;
  }
  if (a.pin) r.sha = got.sha; // lock SHA into the in-memory list for write-back
  const { dir } = got;
  const vet = runVet(dir);
  const vfind = vet.findings
    .filter((f) => f.category === "secret")
    .map((f) => ({ ...f, file: norm(f.file, dir) }));
  let gfind = [];
  if (hasGitleaks) {
    try {
      gfind = runGitleaks(dir, { gitleaksBin: a.gitleaks }).findings.map((f) => ({
        ...f,
        file: norm(f.file, dir),
      }));
    } catch {
      gfind = [];
    }
  }
  const gset = new Set(gfind.map((f) => `${f.file}:${f.line}`));
  const near = (f) =>
    gset.has(`${f.file}:${f.line}`) ||
    gset.has(`${f.file}:${(f.line ?? 0) + 1}`) ||
    gset.has(`${f.file}:${(f.line ?? 0) - 1}`);
  const vset = new Set(vfind.map((f) => `${f.file}:${f.line}`));
  const shared = vfind.filter(near).length;
  rows.push({
    name: r.name,
    type: r.type,
    sha: (got.sha ?? "").slice(0, 10),
    files: vet.filesScanned,
    vetTotal: vfind.length,
    vetOnly: vfind.length - shared,
    gitleaksTotal: hasGitleaks ? gfind.length : null,
    gitleaksOnly: hasGitleaks
      ? gfind.filter(
          (f) =>
            !vset.has(`${f.file}:${f.line}`) &&
            !vset.has(`${f.file}:${(f.line ?? 0) + 1}`) &&
            !vset.has(`${f.file}:${(f.line ?? 0) - 1}`)
        ).length
      : null,
    shared: hasGitleaks ? shared : null,
    byRule: tally(vfind.map((f) => f.rule)),
    findings: vfind.map((f) => ({ repo: r.name, file: f.file, line: f.line, rule: f.rule })),
  });
  process.stderr.write(
    `  ${r.name} [${r.type}]: vet ${vfind.length} (${vfind.length - shared} vet-only)` +
      (hasGitleaks ? `, gitleaks ${gfind.length}` : "") +
      ` in ${vet.filesScanned} files\n`
  );
}

if (a.pin) {
  writeFileSync(a.config, JSON.stringify(repoList, null, 2) + "\n");
  process.stderr.write(`\npinned ${repoList.filter((r) => r.sha).length} SHAs → ${a.config}\n`);
}

// ── aggregate ──
const ok = rows.filter((r) => !r.error);
const per1k = (n, files) => (files ? (n / files) * 1000 : 0);
const totalFiles = ok.reduce((s, r) => s + r.files, 0);
const vetTotal = ok.reduce((s, r) => s + r.vetTotal, 0);
const gitTotal = hasGitleaks ? ok.reduce((s, r) => s + r.gitleaksTotal, 0) : null;
const vetOnly = ok.reduce((s, r) => s + r.vetOnly, 0);
const gitOnly = hasGitleaks ? ok.reduce((s, r) => s + r.gitleaksOnly, 0) : null;
const noisiest = ok.reduce((a2, b) => (b.vetTotal > a2.vetTotal ? b : a2), { vetTotal: -1 });
const woN = ok.filter((r) => r.name !== noisiest.name);
const woNFiles = woN.reduce((s, r) => s + r.files, 0);
const woNVet = woN.reduce((s, r) => s + r.vetTotal, 0);

// ── sample for labeling (seeded, reproducible) ──
if (a["emit-sample"]) {
  const n = Number(a["emit-sample"]);
  const all = ok.flatMap((r) => r.findings);
  let s = Number(a.seed) >>> 0;
  const rnd = () => ((s = (1103515245 * s + 12345) & 0x7fffffff) / 0x7fffffff);
  const shuffled = all
    .map((x) => ({ x, k: rnd() }))
    .sort((p, q) => p.k - q.k)
    .map((p) => p.x);
  const sample = shuffled.slice(0, n).map((f) => ({ ...f, label: "" }));
  const sampPath = `${a.out}-sample.jsonl`;
  writeFileSync(sampPath, sample.map((x) => JSON.stringify(x)).join("\n") + "\n");
  process.stderr.write(
    `\nwrote ${sample.length}-finding sample → ${sampPath}\n` +
      `label each (plain-noise|example|test-fixture|real) by opening bench/.noise/<repo>/<file> at the line,\n` +
      `then: node bench/noise.mjs --labels ${sampPath}\n`
  );
}

const vetVersion = toolVersion(process.execPath, [resolve(HERE, "../dist/bin.js"), "--version"]).split(
  "\n"
)[0];

// ── report ──
const md = [];
md.push(`# Noise benchmark — false alarms on clean popular repos\n`);
md.push(`vet \`${vetVersion}\`` + (hasGitleaks ? ` · gitleaks \`${toolVersion(a.gitleaks, ["version"])}\`` : ""));
md.push(`\nEvery secret finding here is a *candidate* false alarm (these repos hold ~no real secrets).`);
md.push(`Lower is quieter. "vet-only" excludes findings gitleaks also makes.\n`);
md.push(`| repo | type | files | vet total | vet-only${hasGitleaks ? " | gitleaks total | gl-only" : ""} |`);
md.push(`|---|---|--:|--:|--:${hasGitleaks ? "|--:|--:" : ""}|`);
for (const r of rows) {
  if (r.error) {
    md.push(`| ${r.name} | ${r.type} | — | _${r.error}_ |`);
    continue;
  }
  md.push(
    `| ${r.name} | ${r.type} | ${r.files} | ${r.vetTotal} | ${r.vetOnly}` +
      (hasGitleaks ? ` | ${r.gitleaksTotal} | ${r.gitleaksOnly}` : "") +
      ` |`
  );
}
md.push(`\n## Headline (absolute rates, not ratios)\n`);
md.push(`- **vet total alerts/1k files: ${per1k(vetTotal, totalFiles).toFixed(1)}** (${vetTotal} on ${totalFiles} files) — what a user dismisses`);
if (hasGitleaks) {
  md.push(`- gitleaks total alerts/1k: ${per1k(gitTotal, totalFiles).toFixed(1)} (${gitTotal})`);
  md.push(
    `- **absolute gap: ${per1k(vetTotal - gitTotal, totalFiles).toFixed(1)} extra alerts/1k** (${vetTotal - gitTotal} more) — the number that matters`
  );
  md.push(`- vet-only alerts/1k: ${per1k(vetOnly, totalFiles).toFixed(1)} · gitleaks-only: ${per1k(gitOnly, totalFiles).toFixed(1)}`);
}
md.push(`- median vet alerts per repo: ${median(ok.map((r) => r.vetTotal))} · median/1k: ${median(ok.map((r) => per1k(r.vetTotal, r.files))).toFixed(1)}`);
md.push(
  `- without noisiest (${noisiest.name}): vet ${per1k(woNVet, woNFiles).toFixed(1)}/1k (${woNVet} on ${woNFiles} files)`
);
md.push(`\n## vet findings by rule (all repos)\n`);
for (const [rule, n] of Object.entries(tally(ok.flatMap((r) => r.findings.map((f) => f.rule)))))
  md.push(`- \`${rule}\` — ${n}`);
md.push(`\n_Locations only — secret values are never read into or written by this report._\n`);

const mdText = md.join("\n");
writeFileSync(`${a.out}.md`, mdText);
writeFileSync(
  `${a.out}.json`,
  JSON.stringify(
    {
      vetVersion,
      totalFiles,
      vetTotal,
      gitTotal,
      vetOnly,
      gitOnly,
      absoluteGapPer1k: per1k(vetTotal - (gitTotal ?? 0), totalFiles),
      medianPerRepo: median(ok.map((r) => r.vetTotal)),
      withoutNoisiest: { repo: noisiest.name, vetPer1k: per1k(woNVet, woNFiles) },
      repos: rows.map(({ findings, ...r }) => r),
    },
    null,
    2
  )
);
process.stdout.write(mdText + "\n");
process.stderr.write(`wrote ${a.out}.{md,json}\n`);

if (a["fail-over"] && per1k(vetTotal, totalFiles) > Number(a["fail-over"])) {
  process.stderr.write(`FAIL: vet ${per1k(vetTotal, totalFiles).toFixed(1)}/1k > ${a["fail-over"]}\n`);
  process.exit(1);
}
