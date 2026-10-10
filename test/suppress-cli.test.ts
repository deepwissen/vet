import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../src/cli.js";

let dir: string;
const write = (name: string, content: string): string => {
  const p = join(dir, name);
  writeFileSync(p, content);
  return p;
};

function invoke(argv: string[]): { code: number; out: string } {
  let out = "";
  const code = run([...argv, "--no-color"], (s) => (out += s), () => {});
  return { code, out };
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "vet-sup-"));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("vet CLI — inline vet:allow", () => {
  it("suppresses a finding, exits 0, and reports the count", () => {
    const p = write("ok.ts", 'const k = "AKIAIOSFODNN7EXAMPLE1"; // vet:allow aws-access-key\n');
    const r = invoke([p]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("suppressed by vet:allow");
  });

  it("a mismatched rule does NOT suppress the finding", () => {
    const p = write("bad.ts", 'const k = "AKIAIOSFODNN7EXAMPLE1"; // vet:allow trap-unsafe\n');
    const r = invoke([p]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("AWS Access Key");
  });

  it("--no-ignore bypasses inline suppression (audit mode)", () => {
    const p = write("ok2.ts", 'const k = "AKIAIOSFODNN7EXAMPLE1"; // vet:allow\n');
    expect(invoke([p]).code).toBe(0);
    expect(invoke([p, "--no-ignore"]).code).toBe(1);
  });

  it("--json surfaces findingsSuppressed", () => {
    const p = write("ok3.ts", 'const k = "AKIAIOSFODNN7EXAMPLE1"; // vet:allow\n');
    const o = JSON.parse(invoke([p, "--json"]).out);
    expect(o.findingsSuppressed).toBe(1);
    expect(o.findings).toHaveLength(0);
  });
});
