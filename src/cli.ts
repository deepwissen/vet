#!/usr/bin/env node
import { parseArgs } from "node:util";
import { changedSince, expandPaths, readFiles, stagedFiles } from "./discover.js";
import { scanFile } from "./scan.js";
import { renderHuman } from "./report/human.js";
import { renderJson } from "./report/json.js";
import { renderSarif } from "./report/sarif.js";
import type { ScanSummary, Severity, VetFinding } from "./types.js";

const VERSION = "0.1.0"; // keep in sync with package.json

const HELP = `vet — scan what your AI agent is about to touch before you open the PR.

Usage:
  vet [paths...]         Scan the given files/dirs
  vet                    Scan git staged changes (default)
  vet --since <ref>      Scan files changed since a git ref (e.g. main)

Options:
  --json                 Output findings as JSON
  --sarif                Output SARIF 2.1.0 (GitHub code scanning)
  --fail-on <level>      Exit non-zero on: any | error | warning   (default: any)
  --no-color             Disable colored output
  -q, --quiet            Suppress output when there are no findings
  -v, --version          Print version
  -h, --help             Print help

Exit codes: 0 clean · 1 findings at/above --fail-on · 2 usage/error.
All analysis is local and detect-and-explain only — nothing is modified or sent anywhere.`;

function rank(s: Severity): number {
  return s === "error" ? 3 : s === "warning" ? 2 : 1;
}

function run(): number {
  let values: Record<string, unknown>;
  let positionals: string[];
  try {
    const parsed = parseArgs({
      allowPositionals: true,
      options: {
        since: { type: "string" },
        staged: { type: "boolean" },
        json: { type: "boolean" },
        sarif: { type: "boolean" },
        "fail-on": { type: "string", default: "any" },
        "no-color": { type: "boolean" },
        quiet: { type: "boolean", short: "q" },
        version: { type: "boolean", short: "v" },
        help: { type: "boolean", short: "h" },
      },
    });
    values = parsed.values;
    positionals = parsed.positionals;
  } catch (e) {
    process.stderr.write(`vet: ${(e as Error).message}\n`);
    return 2;
  }

  if (values.help) {
    process.stdout.write(HELP + "\n");
    return 0;
  }
  if (values.version) {
    process.stdout.write(VERSION + "\n");
    return 0;
  }

  let paths: string[];
  if (positionals.length > 0) paths = expandPaths(positionals);
  else if (typeof values.since === "string") paths = changedSince(values.since);
  else paths = stagedFiles();

  const files = readFiles(paths);
  const findings: VetFinding[] = [];
  for (const f of files) findings.push(...scanFile(f.path, f.content));

  const summary: ScanSummary = { filesScanned: files.length, findings };

  if (values.json) {
    process.stdout.write(renderJson(summary) + "\n");
  } else if (values.sarif) {
    process.stdout.write(renderSarif(summary) + "\n");
  } else if (!(values.quiet && findings.length === 0)) {
    const color = Boolean(process.stdout.isTTY) && !values["no-color"] && !process.env.NO_COLOR;
    process.stdout.write(renderHuman(summary, color) + "\n");
  }

  if (findings.length === 0) return 0;
  const failOn = String(values["fail-on"]);
  const threshold = failOn === "error" ? 3 : failOn === "warning" ? 2 : 1;
  return findings.some((f) => rank(f.severity) >= threshold) ? 1 : 0;
}

process.exit(run());
