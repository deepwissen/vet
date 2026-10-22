import { DETECTION_DISCLAIMER, IGNORE_CAVEAT } from "@deepwissen/preflight-core";
import type { ScanSummary, Severity, VetFinding } from "../types.js";

// Findings whose remediation is the ignore caveat (shown once per report, not per
// finding — repetition breeds caveat-blindness).
const IGNORE_RULES = new Set(["secret-ai-reachable", "ignore-coverage-gap"]);

const CODES: Record<string, string> = {
  error: "\x1b[31m",
  warning: "\x1b[33m",
  info: "\x1b[36m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  reset: "\x1b[0m",
};

export function renderHuman(summary: ScanSummary, color: boolean): string {
  const paint = (key: string, s: string): string => (color ? `${CODES[key]}${s}${CODES.reset}` : s);

  const notes: string[] = [];
  if (summary.filesIgnored) notes.push(`${summary.filesIgnored} skipped by .vetignore`);
  if (summary.findingsSuppressed)
    notes.push(`${summary.findingsSuppressed} suppressed by vet:allow`);
  const ignoredNote = notes.length ? paint("dim", ` (${notes.join(", ")})`) : "";

  if (summary.findings.length === 0) {
    // No reassuring "✓ no findings": a clean scan is bounded by scanner recall, so
    // it must carry the disclaimer — "0 findings" must never read as "no secrets".
    return (
      `vet: nothing flagged at or above the gate in ${summary.filesScanned} file(s)` +
      ignoredNote +
      "\n" +
      paint("dim", `  note: ${DETECTION_DISCLAIMER}`)
    );
  }

  const byFile = new Map<string, VetFinding[]>();
  for (const f of summary.findings) {
    const list = byFile.get(f.file) ?? [];
    list.push(f);
    byFile.set(f.file, list);
  }

  const lines: string[] = [];
  // The ignore caveat, once at the top (not repeated on every finding).
  if (summary.findings.some((f) => IGNORE_RULES.has(f.rule))) {
    lines.push(paint("dim", `note: ${IGNORE_CAVEAT}`), "");
  }
  for (const [file, items] of byFile) {
    lines.push(paint("bold", file));
    for (const f of items) {
      const loc = f.line ? `:${f.line}` : "";
      lines.push(
        `  ${paint(f.severity, f.severity.toUpperCase())} ${paint("dim", `[${f.category}]`)} ${f.message}` +
          (loc ? paint("dim", `  (${file}${loc})`) : "")
      );
      if (f.suggestion) lines.push("    " + paint("dim", `→ ${f.suggestion}`));
    }
    lines.push("");
  }

  const counts: Record<Severity, number> = { error: 0, warning: 0, info: 0 };
  for (const f of summary.findings) counts[f.severity]++;
  lines.push(
    paint("bold", `${summary.findings.length} finding(s)`) +
      ` across ${byFile.size} file(s) — ` +
      `${counts.error} error, ${counts.warning} warning, ${counts.info} info` +
      ignoredNote
  );
  return lines.join("\n");
}
