import type { ScanSummary } from "../types.js";

export function renderJson(summary: ScanSummary): string {
  return JSON.stringify(
    {
      tool: "vet",
      filesScanned: summary.filesScanned,
      ...(summary.filesIgnored ? { filesIgnored: summary.filesIgnored } : {}),
      ...(summary.findingsSuppressed ? { findingsSuppressed: summary.findingsSuppressed } : {}),
      // Files not scanned because they exceed 1 MB — surfaced in JSON too, so CI
      // pipelines see the warning, not just the human report.
      ...(summary.filesSkippedLarge ? { filesSkippedLarge: summary.filesSkippedLarge } : {}),
      ...(summary.commitsScanned !== undefined ? { commitsScanned: summary.commitsScanned } : {}),
      ...(summary.historyTruncated ? { historyTruncated: true } : {}),
      findings: summary.findings,
    },
    null,
    2
  );
}
