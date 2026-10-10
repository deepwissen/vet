import type { ScanSummary, Severity } from "../types.js";

function level(s: Severity): string {
  return s === "error" ? "error" : s === "warning" ? "warning" : "note";
}

/** Minimal SARIF 2.1.0 — consumable by GitHub code scanning for inline PR annotations. */
export function renderSarif(summary: ScanSummary): string {
  const ruleIds = [...new Set(summary.findings.map((f) => f.rule))];
  const sarif = {
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "vet",
            informationUri: "https://github.com/deepwissen/vet",
            rules: ruleIds.map((id) => ({ id })),
          },
        },
        results: summary.findings.map((f) => ({
          ruleId: f.rule,
          level: level(f.severity),
          message: { text: f.message },
          locations: [
            {
              physicalLocation: {
                artifactLocation: { uri: f.file },
                ...(f.line ? { region: { startLine: f.line } } : {}),
              },
            },
          ],
        })),
      },
    ],
  };
  return JSON.stringify(sarif, null, 2);
}
