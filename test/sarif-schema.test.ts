import { describe, it, expect } from "vitest";
import { renderSarif } from "../src/report/sarif.js";
import type { ScanSummary } from "../src/types.js";

/**
 * Validate SARIF against the structural contract GitHub code scanning enforces
 * when it ingests a results file. A SARIF that parses as JSON but violates these
 * invariants is silently rejected by the upload API — so these are mandatory.
 * Ref: SARIF 2.1.0 §3 + GitHub "SARIF support for code scanning" requirements.
 */
const SARIF_LEVELS = new Set(["error", "warning", "note", "none"]);

function assertValidSarif(doc: unknown): void {
  expect(typeof doc).toBe("object");
  const d = doc as Record<string, any>;

  // Top level
  expect(typeof d.$schema).toBe("string");
  expect(d.version).toBe("2.1.0");
  expect(Array.isArray(d.runs)).toBe(true);
  expect(d.runs.length).toBeGreaterThanOrEqual(1);

  for (const run of d.runs) {
    // tool.driver.name is REQUIRED
    expect(typeof run?.tool?.driver?.name).toBe("string");
    expect(run.tool.driver.name.length).toBeGreaterThan(0);

    // Every rule must have a string id; collect them for result cross-check.
    const rules = run.tool.driver.rules ?? [];
    expect(Array.isArray(rules)).toBe(true);
    const ruleIds = new Set<string>();
    for (const r of rules) {
      expect(typeof r.id).toBe("string");
      expect(r.id.length).toBeGreaterThan(0);
      ruleIds.add(r.id);
    }

    expect(Array.isArray(run.results)).toBe(true);
    for (const res of run.results) {
      // ruleId REQUIRED and must resolve to a declared rule (GitHub requirement)
      expect(typeof res.ruleId).toBe("string");
      expect(ruleIds.has(res.ruleId)).toBe(true);

      // level must be a valid SARIF enum value
      expect(SARIF_LEVELS.has(res.level)).toBe(true);

      // message.text REQUIRED and non-empty
      expect(typeof res.message?.text).toBe("string");
      expect(res.message.text.length).toBeGreaterThan(0);

      // At least one physicalLocation with a non-empty artifact URI
      expect(Array.isArray(res.locations)).toBe(true);
      expect(res.locations.length).toBeGreaterThanOrEqual(1);
      const phys = res.locations[0].physicalLocation;
      expect(typeof phys?.artifactLocation?.uri).toBe("string");
      expect(phys.artifactLocation.uri.length).toBeGreaterThan(0);

      // region.startLine, when present, must be a positive integer (GitHub rejects 0/negatives)
      if (phys.region) {
        expect(Number.isInteger(phys.region.startLine)).toBe(true);
        expect(phys.region.startLine).toBeGreaterThanOrEqual(1);
      }
    }
  }
}

describe("SARIF 2.1.0 schema conformance", () => {
  it("a mixed-severity summary produces GitHub-ingestible SARIF", () => {
    const summary: ScanSummary = {
      filesScanned: 3,
      findings: [
        {
          file: "src/a.ts",
          line: 2,
          rule: "aws-access-key",
          severity: "error",
          category: "secret",
          message: "AWS Access Key found",
        },
        {
          file: "loader.py",
          line: 5,
          rule: "trap-unsafe-deserialization",
          severity: "warning",
          category: "trap",
          message: "pickle.load on untrusted input",
        },
        {
          // no line → region must be omitted, not emitted as startLine:0
          file: "CLAUDE.md",
          rule: "suspicious-instruction",
          severity: "info",
          category: "integrity",
          message: "Possible prompt injection",
        },
      ],
    };
    assertValidSarif(JSON.parse(renderSarif(summary)));
  });

  it("an empty summary still yields a well-formed run", () => {
    assertValidSarif(JSON.parse(renderSarif({ filesScanned: 0, findings: [] })));
  });

  it("omits region entirely when a finding has no line", () => {
    const s = JSON.parse(
      renderSarif({
        filesScanned: 1,
        findings: [
          {
            file: "CLAUDE.md",
            rule: "suspicious-instruction",
            severity: "info",
            category: "integrity",
            message: "x",
          },
        ],
      })
    );
    expect(s.runs[0].results[0].locations[0].physicalLocation.region).toBeUndefined();
  });

  it("info severity maps to SARIF 'note'", () => {
    const s = JSON.parse(
      renderSarif({
        filesScanned: 1,
        findings: [
          { file: "x.ts", rule: "r", severity: "info", category: "trap", message: "m" },
        ],
      })
    );
    expect(s.runs[0].results[0].level).toBe("note");
  });
});
