import { describe, it, expect } from "vitest";
import { applyInlineSuppressions } from "../src/suppress.js";
import type { VetFinding } from "../src/types.js";

function finding(line: number, rule = "aws-access-key"): VetFinding {
  return { file: "f.ts", line, rule, severity: "error", category: "secret", message: "x" };
}

describe("applyInlineSuppressions — same-line vet:allow", () => {
  it("bare vet:allow suppresses any finding on the line", () => {
    const content = 'const k = "AKIA..."; // vet:allow\n';
    const r = applyInlineSuppressions([finding(1)], content);
    expect(r.kept).toHaveLength(0);
    expect(r.suppressed).toBe(1);
  });

  it("rule-scoped vet:allow suppresses only the named rule", () => {
    const content = 'x // vet:allow aws-access-key\n';
    expect(applyInlineSuppressions([finding(1, "aws-access-key")], content).kept).toHaveLength(0);
    expect(applyInlineSuppressions([finding(1, "trap-x")], content).kept).toHaveLength(1);
  });

  it("supports a comma/space list of rules", () => {
    const content = "x // vet:allow aws-access-key, trap-x\n";
    expect(applyInlineSuppressions([finding(1, "trap-x")], content).kept).toHaveLength(0);
  });

  it("ignores a free-text reason after --", () => {
    const content = "x // vet:allow aws-access-key -- documented example key\n";
    expect(applyInlineSuppressions([finding(1, "aws-access-key")], content).kept).toHaveLength(0);
  });

  it("bare vet:allow with a -- reason still suppresses all", () => {
    const content = "x // vet:allow -- known placeholder\n";
    expect(applyInlineSuppressions([finding(1, "anything")], content).kept).toHaveLength(0);
  });
});

describe("applyInlineSuppressions — vet:allow-next-line", () => {
  it("suppresses a finding on the following line", () => {
    const content = "// vet:allow-next-line aws-access-key\nconst k = \"AKIA...\";\n";
    const r = applyInlineSuppressions([finding(2)], content);
    expect(r.kept).toHaveLength(0);
    expect(r.suppressed).toBe(1);
  });

  it("does not suppress the directive's own line", () => {
    const content = "// vet:allow-next-line\nreal();\n";
    // a finding ON line 1 (the directive line) is not suppressed by next-line
    expect(applyInlineSuppressions([finding(1)], content).kept).toHaveLength(1);
  });
});

describe("applyInlineSuppressions — boundaries", () => {
  it("a bare vet:allow does not match vet:allow-next-line as same-line", () => {
    // directive on the finding's own line is the next-line form -> targets line+1, not itself
    const content = "const k = 1; // vet:allow-next-line\n";
    expect(applyInlineSuppressions([finding(1)], content).kept).toHaveLength(1);
  });

  it("a finding with no line number is never inline-suppressed", () => {
    const f = { ...finding(1), line: undefined } as VetFinding;
    const content = "// vet:allow\n";
    expect(applyInlineSuppressions([f], content).kept).toHaveLength(1);
  });

  it("no directive -> everything kept", () => {
    expect(applyInlineSuppressions([finding(1)], "const k = 1;\n").kept).toHaveLength(1);
  });
});
