// bench:noise — false-alarm (noise) test on clean, popular repos vet was never
// tuned on. These projects are well-maintained and hold ~no real secrets, so
// almost every secret finding is a false alarm. This measures the thing users
// feel first and that CredData can't tell you: noise on unfamiliar real code.
//
// Usage:
//   node bench/noise.mjs                       # default repo set, vet (+ gitleaks if on PATH)
//   node bench/noise.mjs --repos a=URL,b=URL   # custom repos (name=git-url)
//   node bench/noise.mjs --tools vet           # vet only
//   node bench/noise.mjs --fail-over <n>       # exit 1 if vet's secret findings/1k files > n
//
// Honest framing: a "finding" here is a *candidate* false alarm — a few of these
// repos ship test fixtures with fake keys, so the per-repo lists are printed for
// eyeballing. Lower is quieter. Secret values are never read or written.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { runVet, runGitleaks, toolVersion } from "./lib/tools.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

// Popular, well-maintained, clean repos across languages — NOT in CredData and
// never tuned against. Moderate size so shallow clones stay fast.
const DEFAULT_REPOS = {
  flask: "https://github.com/pallets/flask",
  requests: "https://github.com/psf/requests",
  express: "https://github.com/expressjs/express",
  gin: "https://github.com/gin-gonic/gin",
  fastapi: "https://github.com/fastapi/fastapi",
};

const { values: a } = parseArgs({
  options: {
    repos: { type: "string" },
    tools: { type: "string", default: "vet,gitleaks" },
    cache: { type: "string", default: join(HERE, ".noise") },
    out: { type: "string", default: join(HERE, "results", "noise") },
    gitleaks: { type: "string", default: process.env.GITLEAKS_BIN ?? "gitleaks" },
    "fail-over": { type: "string" }, // secret findings per 1,000 files
  },
});

const repos = a.repos
  ? Object.fromEntries(
      a.repos.split(",").map((s) => {
        const [name, url] = s.includes("=") ? s.split("=") : [s.split("/").pop(), s];
        return [name.trim(), url.trim()];
      })
    )
  : DEFAULT_REPOS;

const tools = new Set(a.tools.split(",").map((s) => s.trim()));
const hasGitleaks =
  tools.has("gitleaks") && toolVersion(a.gitleaks, ["version"]) !== "unknown";

mkdirSync(a.cache, { recursive: true });
mkdirSync(dirname(a.out), { recursive: true });

/** Shallow-clone (or reuse) a repo into the cache. Returns its path, or null on failure. */
function fetchRepo(name, url) {
  const dir = join(a.cache, name);
  if (existsSync(join(dir, ".git"))) return dir;
  process.stderr.write(`cloning ${name}… `);
  const r = spawnSync("git", ["clone", "--depth", "1", "--quiet", url, dir], { encoding: "utf8" });
  if (r.status !== 0) {
    process.stderr.write(`FAILED (${(r.stderr ?? "").trim().slice(0, 120)})\n`);
    return null;
  }
  process.stderr.write("ok\n");
  return dir;
}

const rows = [];
for (const [name, url] of Object.entries(repos)) {
  const dir = fetchRepo(name, url);
  if (!dir) {
    rows.push({ name, error: "clone failed" });
    continue;
  }
  const vet = runVet(dir);
  const vetSecret = vet.findings.filter((f) => f.category === "secret");
  const row = {
    name,
    files: vet.filesScanned,
    vetSecret: vetSecret.length,
    vetTotal: vet.findings.length,
    vetByRule: tally(vetSecret.map((f) => f.rule)),
    vetFindings: vetSecret.map((f) => `${f.file}:${f.line ?? "?"} (${f.rule})`),
  };
  if (hasGitleaks) {
    try {
      row.gitleaks = runGitleaks(dir, { gitleaksBin: a.gitleaks }).findings.length;
    } catch {
      row.gitleaks = null;
    }
  }
  rows.push(row);
  process.stderr.write(
    `  ${name}: vet ${row.vetSecret} secret finding(s) in ${row.files} files` +
      (hasGitleaks ? ` · gitleaks ${row.gitleaks}` : "") +
      "\n"
  );
}

function tally(arr) {
  const m = {};
  for (const x of arr) m[x] = (m[x] ?? 0) + 1;
  return Object.fromEntries(Object.entries(m).sort((x, y) => y[1] - x[1]));
}

const scanned = rows.filter((r) => !r.error);
const totalFiles = scanned.reduce((s, r) => s + r.files, 0);
const vetSecretTotal = scanned.reduce((s, r) => s + r.vetSecret, 0);
const gitleaksTotal = hasGitleaks ? scanned.reduce((s, r) => s + (r.gitleaks ?? 0), 0) : null;
const vetPer1k = totalFiles ? (vetSecretTotal / totalFiles) * 1000 : 0;
const gitleaksPer1k = hasGitleaks && totalFiles ? (gitleaksTotal / totalFiles) * 1000 : null;

const vetVersion = toolVersion(process.execPath, [resolve(HERE, "../dist/bin.js"), "--version"]).split(
  "\n"
)[0];

// ── Markdown report ──
const md = [];
md.push(`# Noise benchmark — false alarms on clean popular repos\n`);
md.push(
  `vet \`${vetVersion}\`` + (hasGitleaks ? ` · gitleaks \`${toolVersion(a.gitleaks, ["version"])}\`` : "")
);
md.push(
  `\nEvery secret finding on these repos is a *candidate* false alarm (they hold ~no real secrets). Lower is quieter.\n`
);
md.push(`| repo | files | vet secret FPs${hasGitleaks ? " | gitleaks FPs" : ""} |`);
md.push(`|---|--:|--:${hasGitleaks ? "|--:" : ""}|`);
for (const r of rows) {
  if (r.error) {
    md.push(`| ${r.name} | — | _${r.error}_${hasGitleaks ? " | —" : ""} |`);
    continue;
  }
  md.push(`| ${r.name} | ${r.files} | ${r.vetSecret}${hasGitleaks ? ` | ${r.gitleaks ?? "err"}` : ""} |`);
}
md.push(
  `| **total** | **${totalFiles}** | **${vetSecretTotal}** (${vetPer1k.toFixed(1)}/1k)` +
    (hasGitleaks ? ` | **${gitleaksTotal}** (${gitleaksPer1k.toFixed(1)}/1k)` : "") +
    ` |`
);
md.push(`\n## vet secret findings by rule (all repos)\n`);
const allByRule = tally(scanned.flatMap((r) => Object.entries(r.vetByRule).flatMap(([k, n]) => Array(n).fill(k))));
for (const [rule, n] of Object.entries(allByRule)) md.push(`- \`${rule}\` — ${n}`);
md.push(`\n## Candidate false alarms (locations only — eyeball these)\n`);
for (const r of scanned) {
  if (!r.vetFindings.length) continue;
  md.push(`**${r.name}**`);
  for (const f of r.vetFindings.slice(0, 40)) md.push(`- ${f}`);
  if (r.vetFindings.length > 40) md.push(`- … and ${r.vetFindings.length - 40} more`);
  md.push("");
}
md.push(`_Locations only — secret values are never read into or written by this report._\n`);

const mdText = md.join("\n");
writeFileSync(`${a.out}.md`, mdText);
writeFileSync(
  `${a.out}.json`,
  JSON.stringify(
    { vetVersion, totalFiles, vetSecretTotal, vetPer1k, gitleaksTotal, gitleaksPer1k, repos: rows },
    null,
    2
  )
);
process.stdout.write(mdText + "\n");
process.stderr.write(`\nwrote ${a.out}.{md,json}\n`);

// Optional CI-style gate on noise rate.
if (a["fail-over"] && vetPer1k > Number(a["fail-over"])) {
  process.stderr.write(`FAIL: vet noise ${vetPer1k.toFixed(1)}/1k files > ${a["fail-over"]}\n`);
  process.exit(1);
}
