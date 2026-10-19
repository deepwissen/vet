import { parseArgs } from "node:util";
import { relative, resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, existsSync } from "node:fs";
import { changedSince, expandPaths, readFiles, stagedFiles } from "./discover.js";
import { loadIgnore } from "./ignore.js";
import { applyInlineSuppressions } from "./suppress.js";
import { scanFile } from "./scan.js";
import { renderHuman } from "./report/human.js";
import { renderJson } from "./report/json.js";
import { renderSarif } from "./report/sarif.js";
import type { ScanSummary, Severity, VetFinding } from "./types.js";

const VERSION = "0.1.6"; // keep in sync with package.json

/** Resolve the actual @deepwissen/preflight-core version in use (the engine that
 *  carries the detection rules), so `vet --version` shows which engine a user is
 *  on — it's a version range, so this can lag/lead vet's own version. Walks up
 *  from this file looking for the engine's package.json under node_modules
 *  (handles both hoisted and nested installs; core is ESM-only so require.resolve
 *  doesn't work on it). */
function engineVersion(): string | null {
  try {
    let dir = dirname(fileURLToPath(import.meta.url));
    for (let i = 0; i < 8; i++) {
      const pkg = join(dir, "node_modules", "@deepwissen", "preflight-core", "package.json");
      if (existsSync(pkg)) {
        const v = JSON.parse(readFileSync(pkg, "utf8")).version;
        return typeof v === "string" ? v : null;
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return null;
  } catch {
    return null;
  }
}

const HELP = `vet — scan what your AI agent is about to touch before you open the PR.

Usage:
  vet [paths...]         Scan the given files/dirs
  vet                    Scan git staged changes (default)
  vet --since <ref>      Scan files changed since a git ref (e.g. main)

Options:
  --json                 Output findings as JSON
  --sarif                Output SARIF 2.1.0 (GitHub code scanning)
  --fail-on <level>      Exit non-zero on: any | error | warning   (default: error)
  --ignore-file <path>   Allowlist of path globs to skip (default: .vetignore)
  --no-ignore            Bypass .vetignore — scan everything
  --no-color             Disable colored output
  -q, --quiet            Suppress output when there are no findings
  -v, --version          Print version
  -h, --help             Print help

Exit codes: 0 clean · 1 findings at/above --fail-on · 2 usage/error.
All analysis is local and detect-and-explain only — nothing is modified or sent anywhere.`;

function rank(s: Severity): number {
  return s === "error" ? 3 : s === "warning" ? 2 : 1;
}

export function run(
  argv: string[],
  out: (s: string) => void = (s) => void process.stdout.write(s),
  err: (s: string) => void = (s) => void process.stderr.write(s)
): number {
  let values: Record<string, unknown>;
  let positionals: string[];
  try {
    const parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        since: { type: "string" },
        staged: { type: "boolean" },
        json: { type: "boolean" },
        sarif: { type: "boolean" },
        "fail-on": { type: "string", default: "error" },
        "ignore-file": { type: "string" },
        "no-ignore": { type: "boolean" },
        "no-color": { type: "boolean" },
        quiet: { type: "boolean", short: "q" },
        version: { type: "boolean", short: "v" },
        help: { type: "boolean", short: "h" },
      },
    });
    values = parsed.values;
    positionals = parsed.positionals;
  } catch (e) {
    err(`vet: ${(e as Error).message}\n`);
    return 2;
  }

  if (values.help) {
    out(HELP + "\n");
    return 0;
  }
  if (values.version) {
    const engine = engineVersion();
    out(VERSION + (engine ? ` (engine @deepwissen/preflight-core ${engine})` : "") + "\n");
    return 0;
  }

  let paths: string[];
  if (positionals.length > 0) paths = expandPaths(positionals);
  else if (typeof values.since === "string") paths = changedSince(values.since);
  else paths = stagedFiles();

  // Apply .vetignore path globs before scanning (skipped files are never read).
  let filesIgnored = 0;
  if (!values["no-ignore"]) {
    const ignoreFile =
      typeof values["ignore-file"] === "string" ? values["ignore-file"] : undefined;
    const ignore = loadIgnore(process.cwd(), ignoreFile);
    if (ignore.patternCount > 0) {
      const kept: string[] = [];
      for (const p of paths) {
        const rel = relative(process.cwd(), resolve(p)) || p;
        if (ignore.matchPath(rel)) filesIgnored++;
        else kept.push(p);
      }
      paths = kept;
    }
  }

  const files = readFiles(paths);
  const findings: VetFinding[] = [];
  let findingsSuppressed = 0;
  for (const f of files) {
    const found = scanFile(f.path, f.content);
    if (values["no-ignore"]) {
      findings.push(...found); // audit mode: bypass inline suppression too
    } else {
      const { kept, suppressed } = applyInlineSuppressions(found, f.content);
      findings.push(...kept);
      findingsSuppressed += suppressed;
    }
  }

  const summary: ScanSummary = { filesScanned: files.length, findings };
  if (filesIgnored > 0) summary.filesIgnored = filesIgnored;
  if (findingsSuppressed > 0) summary.findingsSuppressed = findingsSuppressed;

  if (values.json) {
    out(renderJson(summary) + "\n");
  } else if (values.sarif) {
    out(renderSarif(summary) + "\n");
  } else if (!(values.quiet && findings.length === 0)) {
    const color = Boolean(process.stdout.isTTY) && !values["no-color"] && !process.env.NO_COLOR;
    out(renderHuman(summary, color) + "\n");
  }

  if (findings.length === 0) return 0;
  const failOn = String(values["fail-on"]);
  const threshold = failOn === "error" ? 3 : failOn === "warning" ? 2 : 1;
  return findings.some((f) => rank(f.severity) >= threshold) ? 1 : 0;
}
