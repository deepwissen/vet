#!/usr/bin/env node
// Generates a small labeled corpus for smoke-testing the benchmark.
//
//   node bench/sample/make-sample.mjs <out-dir> [--seed 42] [--copies 3]
//
// Writes <out-dir>/corpus/** and <out-dir>/labels.jsonl. Every "secret" is random
// text in the right shape for its provider — none are real credentials. Decoys are
// the things that fool scanners in real repos: documented example keys,
// placeholders, env-var references, hashes, UUIDs, lockfile integrity strings.
//
// Generated at run time on purpose: committing provider-shaped strings would trip
// GitHub push protection and other people's scanners.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";

const { values: a, positionals } = parseArgs({
  allowPositionals: true,
  options: { seed: { type: "string", default: "42" }, copies: { type: "string", default: "3" } },
});
const outDir = positionals[0];
if (!outDir) { console.error("usage: make-sample.mjs <out-dir> [--seed 42] [--copies 3]"); process.exit(2); }

// Deterministic PRNG so every run of the benchmark sees the same corpus.
let s = Number(a.seed) >>> 0;
const rnd = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const chars = (set, n) => Array.from({ length: n }, () => pick(set)).join("");
// Strings below are assembled from parts so this script doesn't trip secret
// scanners itself (vet runs on this repo too).
const range = (from, n) => Array.from({ length: n }, (_, i) => String.fromCharCode(from.charCodeAt(0) + i)).join("");
const UP = range("A", 26), LO = range("a", 26), DIG = range("0", 10);
const pem = (edge, kind) => `-----${edge} ${kind}-----`;
const AN = UP + LO + DIG, B64 = AN + "+/", B64URL = AN + "-_", HEX = "0123456789abcdef";
const b64url = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");

// ---- real-secret shapes (truth: true) -------------------------------------------
const SECRETS = {
  "aws-access-key": () => ({ name: "aws_access_key_id", value: "AKIA" + chars("ABCDEFGHIJKLMNOPQRSTUVWXYZ234567", 16) }),
  "aws-secret-key": () => ({ name: "aws_secret_access_key", value: chars(B64, 40) }),
  "github-pat": () => ({ name: "GITHUB_TOKEN", value: "ghp_" + chars(AN, 36) }),
  "github-fine-grained": () => ({ name: "GH_PAT", value: "github_pat_" + chars(AN, 22) + "_" + chars(AN, 59) }),
  "stripe-live": () => ({ name: "STRIPE_SECRET_KEY", value: "sk_live_" + chars(AN, 24) }),
  "slack-bot": () => ({ name: "SLACK_BOT_TOKEN", value: `xoxb-${chars(DIG, 12)}-${chars(DIG, 13)}-${chars(AN, 24)}` }),
  "openai": () => ({ name: "OPENAI_API_KEY", value: "sk-proj-" + chars(B64URL, 48) + "T3BlbkFJ" + chars(B64URL, 48) }),
  "anthropic": () => ({ name: "ANTHROPIC_API_KEY", value: "sk-ant-api03-" + chars(B64URL, 93) + "AA" }),
  "google-api": () => ({ name: "GOOGLE_API_KEY", value: "AIza" + chars(B64URL, 35) }),
  "npm-token": () => ({ name: "NPM_TOKEN", value: "npm_" + chars(AN, 36) }),
  "sendgrid": () => ({ name: "SENDGRID_API_KEY", value: `SG.${chars(B64URL, 22)}.${chars(B64URL, 43)}` }),
  "jwt": () => ({ name: "AUTH_TOKEN", value: `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({ sub: chars(DIG, 8), name: "svc", iat: 1700000000 + Math.floor(rnd() * 1e7) })}.${chars(B64URL, 43)}` }),
  "postgres-url": () => ({ name: "DATABASE_URL", value: `postgres://app_user:${chars(AN, 18)}@db-${chars(LO, 6)}.internal:5432/prod` }),
  "url-credentials": () => ({ name: "UPSTREAM_URL", value: `https://deploy:${chars(AN, 20)}@api.${chars(LO, 7)}.io/v2` }),
  "generic-password": () => ({ name: "DB_PASSWORD", value: chars(AN + "!#%^*", 22) }),
};

// ---- decoys (truth: false) ------------------------------------------------------
const DECOYS = {
  "aws-docs-example": () => ({ name: "aws_access_key_id", value: "AKIA" + "IOSFODNN7EXAMPLE" }),
  "aws-docs-example-secret": () => ({ name: "aws_secret_access_key", value: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY" }),
  "placeholder": () => ({ name: "API_KEY", value: pick(["your-api-key-here", "<YOUR_API_KEY>", "changeme", "REPLACE_ME", "x".repeat(28), "sk_" + "live_" + "x".repeat(24), "TODO"]) }),
  "env-reference": () => ({ name: "STRIPE_SECRET_KEY", value: pick(["${STRIPE_SECRET_KEY}", "$GITHUB_TOKEN", "{{ secrets.NPM_TOKEN }}", "%(DB_PASSWORD)s"]) }),
  "git-sha": () => ({ name: "commit", value: chars(HEX, 40) }),
  "sha256": () => ({ name: "checksum", value: chars(HEX, 64) }),
  "uuid": () => ({ name: "request_id", value: `${chars(HEX, 8)}-${chars(HEX, 4)}-4${chars(HEX, 3)}-a${chars(HEX, 3)}-${chars(HEX, 12)}` }),
  "public-id": () => ({ name: "STRIPE_PUBLISHABLE_KEY", value: "pk_test_" + chars(AN, 24) }),
};

// ---- file templates: how a NAME=VALUE pair is written in each file type --------
const FORMATS = [
  { ext: "config/settings.py", line: (n, v) => `${n.toUpperCase()} = "${v}"`, head: ["import os", ""] },
  { ext: "src/client.ts", line: (n, v) => `const ${camel(n)} = "${v}";`, head: ["import { request } from './http';", ""] },
  { ext: "src/legacy.js", line: (n, v) => `  ${camel(n)}: '${v}',`, head: ["module.exports = {"], tail: ["};"] },
  { ext: "deploy/values.yaml", line: (n, v) => `${n.toLowerCase()}: "${v}"`, head: ["service:", "  replicas: 2"] },
  { ext: "config/app.json", json: true },
  { ext: ".env.production", line: (n, v) => `${n.toUpperCase()}=${v}` },
  { ext: "pyproject.toml", line: (n, v) => `${n.toLowerCase()} = "${v}"`, head: ["[tool.app]"] },
  { ext: "infra/main.tf", line: (n, v) => `  ${n.toLowerCase()} = "${v}"`, head: ['resource "app_config" "main" {'], tail: ["}"] },
  { ext: "scripts/deploy.sh", line: (n, v) => `export ${n.toUpperCase()}="${v}"`, head: ["#!/usr/bin/env bash", "set -euo pipefail"] },
  { ext: "docs/setup.md", line: (n, v) => `    ${n.toUpperCase()}=${v}`, head: ["# Setup", "", "Set these before running:", ""] },
  { ext: "notes.txt", line: (n, v) => `${n}: ${v}` },
];
function camel(n) { return n.toLowerCase().replace(/_([a-z])/g, (_, c) => c.toUpperCase()); }

const files = new Map(); // path -> { lines: [], labels: [] }
function add(path, fmt, kind, type, gen, truth) {
  if (!files.has(path)) files.set(path, { fmt, lines: [...(fmt.head ?? [])], labels: [], json: [] });
  const f = files.get(path);
  const { name, value } = gen();
  if (fmt.json) { f.json.push({ name, value, type, truth }); return; }
  f.lines.push(fmt.line(name, value));
  f.labels.push({ line: f.lines.length, endLine: f.lines.length, truth, type });
  f.lines.push(""); // spacer so a ±1 line tolerance can't blur neighbouring labels
}

const copies = Number(a.copies);
for (let c = 0; c < copies; c++) {
  for (const [type, gen] of Object.entries(SECRETS)) {
    const fmt = pick(FORMATS);
    add(`svc-${c}/${fmt.ext}`, fmt, "secret", type, gen, true);
  }
  for (const [type, gen] of Object.entries(DECOYS)) {
    const fmt = pick(FORMATS);
    add(`svc-${c}/${fmt.ext}`, fmt, "decoy", type, gen, false);
  }
  // Private key (multi-line range) and a public key decoy.
  const key = [pem("BEGIN", "RSA PRIVATE KEY"), ...Array.from({ length: 12 }, () => chars(B64, 64)), chars(B64, 24) + "==", pem("END", "RSA PRIVATE KEY")];
  files.set(`svc-${c}/certs/server.key`, { lines: key, labels: [{ line: 1, endLine: key.length, truth: true, type: "private-key" }] });
  const pub = [pem("BEGIN", "PUBLIC KEY"), ...Array.from({ length: 6 }, () => chars(B64, 64)), pem("END", "PUBLIC KEY")];
  files.set(`svc-${c}/certs/server.pub`, { lines: pub, labels: [{ line: 1, endLine: pub.length, truth: false, type: "public-key" }] });
  // Lockfile integrity hashes — a classic source of high-entropy false alarms.
  const lock = ["{", '  "packages": {'];
  const lockLabels = [];
  for (let i = 0; i < 4; i++) {
    lock.push(`    "node_modules/pkg-${i}": { "version": "1.${i}.0", "integrity": "sha512-${chars(B64, 86)}==" },`);
    lockLabels.push({ line: lock.length, endLine: lock.length, truth: false, type: "lockfile-integrity" });
  }
  lock.push("  }", "}");
  files.set(`svc-${c}/package-lock.json`, { lines: lock, labels: lockLabels });
}

// Render JSON files last so line numbers are known.
for (const [path, f] of files) {
  if (!f.fmt?.json) continue;
  const lines = ["{"];
  f.json.forEach((e, i) => {
    lines.push(`  "${e.name}": "${e.value}"${i < f.json.length - 1 ? "," : ""}`);
    f.labels.push({ line: lines.length, endLine: lines.length, truth: e.truth, type: e.type });
  });
  lines.push("}");
  f.lines = lines;
}

const labels = [];
for (const [path, f] of files) {
  if (f.fmt?.tail) f.lines.push(...f.fmt.tail);
  const full = join(outDir, "corpus", path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, f.lines.join("\n") + "\n");
  for (const l of f.labels) labels.push(JSON.stringify({ file: path, ...l }));
}
writeFileSync(join(outDir, "labels.jsonl"), labels.join("\n") + "\n");
const t = labels.filter((l) => l.includes('"truth":true')).length;
console.error(`wrote ${files.size} files, ${t} secrets, ${labels.length - t} decoys → ${outDir}`);
