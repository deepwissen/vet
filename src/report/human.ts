import type { ScanSummary, Severity, VetFinding } from "../types.js";

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

  const ignoredNote = summary.filesIgnored
    ? paint("dim", ` (${summary.filesIgnored} skipped by .vetignore)`)
    : "";

  if (summary.findings.length === 0) {
    return (
      paint("info", "✓") + ` vet: no findings in ${summary.filesScanned} file(s)` + ignoredNote
    );
  }

  const byFile = new Map<string, VetFinding[]>();
  for (const f of summary.findings) {
    const list = byFile.get(f.file) ?? [];
    list.push(f);
    byFile.set(f.file, list);
  }

  const lines: string[] = [];
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
