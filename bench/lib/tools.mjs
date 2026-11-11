// Runs each scanner over a corpus and normalizes its output to
//   { tool, file, line, endLine, rule, category }
// `file` is always relative to the corpus root, with forward slashes.
// No adapter ever reads or keeps the secret value itself.

import { execFileSync, spawnSync } from "node:child_process";
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const VET_BIN = resolve(HERE, "../../dist/bin.js");

export function rel(corpus, file) {
  const abs = isAbsolute(file) ? file : resolve(corpus, file);
  return relative(resolve(corpus), abs).split("\\").join("/");
}

function timed(fn) {
  const t0 = process.hrtime.bigint();
  const out = fn();
  return { out, ms: Number(process.hrtime.bigint() - t0) / 1e6 };
}

/** vet: `vet <corpus> --json --no-ignore`. Exit 1 just means "found something". */
export function runVet(corpus, { vetBin = VET_BIN } = {}) {
  // stdout goes to a file, not a pipe: vet 0.1.9 calls process.exit() right after
  // writing, which truncates piped output at 64 KB (see bench/README.md).
  const dir = mkdtempSync(join(tmpdir(), "vet-bench-"));
  const outPath = join(dir, "vet.json");
  const fd = openSync(outPath, "w");
  let out, ms;
  try {
    ({ out, ms } = timed(() =>
      spawnSync(process.execPath, [vetBin, corpus, "--json", "--no-ignore", "--no-color"], {
        encoding: "utf8",
        stdio: ["ignore", fd, "pipe"],
      })
    ));
  } finally {
    closeSync(fd);
  }
  const stdout = readFileSync(outPath, "utf8");
  rmSync(dir, { recursive: true, force: true });
  if (out.status === 2 || !stdout.trim()) {
    throw new Error(`vet failed (exit ${out.status}): ${(out.stderr ?? "").slice(0, 500)}`);
  }
  const report = JSON.parse(stdout);
  const findings = report.findings.map((f) => ({
    tool: "vet",
    file: rel(corpus, f.file),
    line: f.line ?? null,
    endLine: f.line ?? null,
    rule: f.rule,
    category: f.category, // secret | trap | integrity | mcp | agent
  }));
  return { findings, ms, filesScanned: report.filesScanned };
}

/** gitleaks: `gitleaks dir` (working tree, no git history) so it sees what vet sees. */
export function runGitleaks(corpus, { gitleaksBin = "gitleaks" } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "vet-bench-"));
  const reportPath = join(dir, "gitleaks.json");
  try {
    const { out, ms } = timed(() =>
      spawnSync(
        gitleaksBin,
        [
          "dir",
          resolve(corpus),
          "--report-format", "json",
          "--report-path", reportPath,
          "--redact", // never write secret values to disk
          "--no-banner",
          "--exit-code", "0",
          "--log-level", "error",
        ],
        { encoding: "utf8", maxBuffer: 1024 * 1024 * 64 }
      )
    );
    if (out.error) throw new Error(`gitleaks not runnable (${gitleaksBin}): ${out.error.message}`);
    if (out.status !== 0) throw new Error(`gitleaks failed (exit ${out.status}): ${out.stderr.slice(0, 500)}`);
    const raw = JSON.parse(readFileSync(reportPath, "utf8") || "[]");
    const findings = raw.map((f) => ({
      tool: "gitleaks",
      file: rel(corpus, f.File),
      line: f.StartLine,
      endLine: f.EndLine ?? f.StartLine,
      rule: f.RuleID,
      category: "secret",
    }));
    return { findings, ms };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function toolVersion(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "unknown";
  }
}
