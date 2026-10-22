import { describe, it, expect } from "vitest";
import { renderJson } from "../src/report/json.js";
import { renderSarif } from "../src/report/sarif.js";
import { renderHuman } from "../src/report/human.js";
import type { ScanSummary } from "../src/types.js";

const summary: ScanSummary = {
  filesScanned: 2,
  findings: [
    {
      file: "src/a.ts",
      line: 2,
      rule: "aws-access-key",
      severity: "error",
      category: "secret",
      message: "AWS Access Key found in a.ts line 2",
      suggestion: "move it",
    },
    {
      file: "src/b.py",
      line: 5,
      rule: "trap-unsafe-deserialization",
      severity: "warning",
      category: "trap",
      message: "pickle.load in b.py line 5",
    },
  ],
};

const empty: ScanSummary = { filesScanned: 3, findings: [] };

describe("renderJson", () => {
  it("emits tool + findings", () => {
    const o = JSON.parse(renderJson(summary));
    expect(o.tool).toBe("vet");
    expect(o.filesScanned).toBe(2);
    expect(o.findings).toHaveLength(2);
    expect(o.findings[0].rule).toBe("aws-access-key");
  });
});

describe("renderSarif", () => {
  it("emits valid SARIF 2.1.0 with results and rules", () => {
    const s = JSON.parse(renderSarif(summary));
    expect(s.version).toBe("2.1.0");
    const run = s.runs[0];
    expect(run.tool.driver.name).toBe("vet");
    expect(run.results).toHaveLength(2);
    expect(run.results[0].level).toBe("error");
    expect(run.results[1].level).toBe("warning");
    expect(run.results[0].locations[0].physicalLocation.region.startLine).toBe(2);
    expect(run.tool.driver.rules.map((r: { id: string }) => r.id)).toContain("aws-access-key");
  });
});

describe("renderHuman", () => {
  it("a clean run carries the recall disclaimer and NO bare '✓ no findings'", () => {
    const out = renderHuman(empty, false);
    // structural enforcement: the reassuring string is gone, the disclaimer is mandatory
    expect(out).not.toMatch(/✓\s*vet: no findings/);
    expect(out).toMatch(/does NOT mean none are present/i);
    expect(out).toMatch(/nothing flagged/i);
  });

  it("groups findings and summarizes counts (no color)", () => {
    const out = renderHuman(summary, false);
    expect(out).toContain("src/a.ts");
    expect(out).toContain("ERROR");
    expect(out).toContain("[trap]");
    expect(out).toMatch(/2 finding\(s\).*1 error, 1 warning/s);
    expect(out).not.toContain("\x1b["); // no ANSI when color off
  });

  it("adds ANSI codes when color is on", () => {
    expect(renderHuman(summary, true)).toContain("\x1b[");
  });
});
