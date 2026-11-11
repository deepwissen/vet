#!/usr/bin/env node
// vet secret-detection benchmark.
//
//   node bench/run.mjs --corpus <dir> --labels <path> [options]
//
// Options
//   --labels-format jsonl|creddata|secretbench   (default: jsonl)
//   --dataset <name>          label used in the report title (default: corpus folder name)
//   --tools vet,gitleaks      which scanners to run (default: both)
//   --gitleaks <path>         gitleaks binary (default: "gitleaks" on PATH, or $GITLEAKS_BIN)
//   --tolerance <n>           accept a finding within n lines of a labeled range (default: 0)
//   --keep-missing            keep labels whose file is absent from the corpus (default: drop)
//   --max-file-bytes <n>      score only files up to n bytes (labels and findings of every tool)
//   --skip-dirs a,b,c         score only files outside these directory names
//   --vet-scope               shorthand for vet's own limits: --max-file-bytes 1000000
//                             --skip-dirs node_modules,.git,dist,build,out,coverage,.next
//                             (compare like for like on files vet actually reads)
//   --out <dir>               where to write results.{json,md,html} (default: bench/results)
//   --fail-under-recall <x>   exit 1 if vet's recall < x (0–1) — for CI regression gates
//   --fail-under-precision <x>

import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { runVet, runGitleaks, toolVersion } from "./lib/tools.mjs";
import { loadLabels, keepPresent } from "./lib/labels.mjs";
import { score, headToHead } from "./lib/score.mjs";
import { toJson, toMarkdown, toHtml } from "./lib/report.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

const { values: a } = parseArgs({
  options: {
    corpus: { type: "string" },
    labels: { type: "string" },
    "labels-format": { type: "string", default: "jsonl" },
    dataset: { type: "string" },
    tools: { type: "string", default: "vet,gitleaks" },
    gitleaks: { type: "string", default: process.env.GITLEAKS_BIN ?? "gitleaks" },
    tolerance: { type: "string", default: "0" },
    "keep-missing": { type: "boolean", default: false },
    "max-file-bytes": { type: "string" },
    "skip-dirs": { type: "string" },
    "vet-scope": { type: "boolean", default: false },
    out: { type: "string", default: join(HERE, "results") },
    "fail-under-recall": { type: "string" },
    "fail-under-precision": { type: "string" },
  },
});

if (!a.corpus || !a.labels) {
  console.error("usage: node bench/run.mjs --corpus <dir> --labels <path> [--labels-format jsonl|creddata|secretbench]");
  process.exit(2);
}

const corpus = resolve(a.corpus);
const tolerance = Number(a.tolerance);
let labels = loadLabels(resolve(a.labels), a["labels-format"]);
let dropped = 0;
if (!a["keep-missing"]) ({ kept: labels, dropped } = keepPresent(labels, corpus));

// Optional scope filter, applied identically to labels and to every tool's findings.
if (a["vet-scope"]) {
  a["max-file-bytes"] ??= "1000000"; // vet + preflight-core (>= 0.1.17) skip files over 1 MB
  a["skip-dirs"] ??= "node_modules,.git,dist,build,out,coverage,.next";
}
const maxBytes = a["max-file-bytes"] ? Number(a["max-file-bytes"]) : Infinity;
const skipDirs = new Set((a["skip-dirs"] ?? "").split(",").map((s) => s.trim()).filter(Boolean));
const sizeCache = new Map();
function inScope(file) {
  if (skipDirs.size && file.split("/").slice(0, -1).some((d) => skipDirs.has(d))) return false;
  if (maxBytes === Infinity) return true;
  if (!sizeCache.has(file)) {
    try { sizeCache.set(file, statSync(join(corpus, file)).size); } catch { sizeCache.set(file, Infinity); }
  }
  return sizeCache.get(file) <= maxBytes;
}
const scoped = maxBytes !== Infinity || skipDirs.size > 0;
const outOfScope = scoped ? labels.filter((l) => !inScope(l.file)).length : 0;
if (scoped) labels = labels.filter((l) => inScope(l.file));

const tools = {};
for (const name of a.tools.split(",").map((s) => s.trim())) {
  process.stderr.write(`running ${name}… `);
  if (name === "vet") {
    const r = runVet(corpus);
    tools.vet = { ...r, version: toolVersion(process.execPath, [join(HERE, "../dist/bin.js"), "--version"]) };
  } else if (name === "gitleaks") {
    const r = runGitleaks(corpus, { gitleaksBin: a.gitleaks });
    tools.gitleaks = { ...r, version: toolVersion(a.gitleaks, ["version"]) };
  } else throw new Error(`unknown tool ${name}`);
  const findings = scoped ? tools[name].findings.filter((f) => inScope(f.file)) : tools[name].findings;
  tools[name].score = score(findings, labels, { tolerance });
  delete tools[name].findings;
  process.stderr.write(`${(tools[name].ms / 1000).toFixed(2)}s\n`);
}

const names = Object.keys(tools);
const run = {
  dataset: a.dataset ?? basename(corpus),
  date: new Date().toISOString().slice(0, 10),
  corpus: a.corpus,
  tolerance,
  labels: {
    trueSecrets: labels.filter((l) => l.truth).length,
    decoys: labels.filter((l) => !l.truth).length,
    dropped,
    outOfScope,
  },
  scope: scoped ? { maxFileBytes: maxBytes === Infinity ? null : maxBytes, skipDirs: [...skipDirs] } : null,
  tools,
  headToHead: names.length === 2 ? headToHead(tools[names[0]].score, tools[names[1]].score, labels) : undefined,
};

mkdirSync(a.out, { recursive: true });
writeFileSync(join(a.out, "results.json"), toJson(run));
writeFileSync(join(a.out, "results.md"), toMarkdown(run));
writeFileSync(join(a.out, "results.html"), toHtml(run));
console.log(toMarkdown(run).split("\n## ")[0]); // summary table to stdout
console.error(`\nwrote ${join(a.out, "results.{json,md,html}")}`);

const v = tools.vet?.score;
if (v && a["fail-under-recall"] && (v.recall ?? 0) < Number(a["fail-under-recall"])) {
  console.error(`FAIL: vet recall ${v.recall} < ${a["fail-under-recall"]}`);
  process.exit(1);
}
if (v && a["fail-under-precision"] && (v.precision ?? 0) < Number(a["fail-under-precision"])) {
  console.error(`FAIL: vet precision ${v.precision} < ${a["fail-under-precision"]}`);
  process.exit(1);
}
