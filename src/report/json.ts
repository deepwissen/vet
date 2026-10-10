import type { ScanSummary } from "../types.js";

export function renderJson(summary: ScanSummary): string {
  return JSON.stringify(
    { tool: "vet", filesScanned: summary.filesScanned, findings: summary.findings },
    null,
    2
  );
}
