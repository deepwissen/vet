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

// Capture run() output + exit code without touching the real process.
function invoke(argv: string[]): { code: number; out: string; err: string } {
  let out = "";
  let err = "";
  const code = run(
    [...argv, "--no-color"],
    (s) => (out += s),
    (s) => (err += s)
  );
  return { code, out, err };
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "vet-cli-"));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("vet CLI — exit codes & scanning", () => {
  it("exits 0 and reports clean for a safe file", () => {
    const p = write("clean.ts", "export const add = (a: number, b: number) => a + b;\n");
    const r = invoke([p]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/no findings/);
  });

  it("exits 1 and reports a secret", () => {
    const p = write("secret.ts", 'const k = "AKIAIOSFODNN7EXAMPLE1";\n');
    const r = invoke([p]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("AWS Access Key");
    expect(r.out).toContain("ERROR");
  });

  it("default (fail-on error) ignores warning-only findings (trap)", () => {
    const p = write("trap.py", "import pickle\ndata = pickle.load(open('x.pkl'))\n");
    expect(invoke([p]).code).toBe(0); // default fail-on error → warning does not trip
    expect(invoke([p, "--fail-on", "any"]).code).toBe(1); // but fail-on any does
  });

  it("--fail-on warning trips on a warning", () => {
    const p = write("trap2.py", "import pickle\npickle.load(f)\n");
    expect(invoke([p, "--fail-on", "warning"]).code).toBe(1);
  });
});

describe("vet CLI — output modes", () => {
  it("--json emits parseable findings", () => {
    const p = write("s.ts", 'const k = "AKIAIOSFODNN7EXAMPLE1";\n');
    const r = invoke([p, "--json"]);
    const o = JSON.parse(r.out);
    expect(o.tool).toBe("vet");
    expect(o.findings.length).toBeGreaterThan(0);
  });

  it("--sarif emits SARIF 2.1.0", () => {
    const p = write("s2.ts", 'const k = "AKIAIOSFODNN7EXAMPLE1";\n');
    const s = JSON.parse(invoke([p, "--sarif"]).out);
    expect(s.version).toBe("2.1.0");
    expect(s.runs[0].results.length).toBeGreaterThan(0);
  });

  it("--quiet suppresses output on a clean run", () => {
    const p = write("ok.ts", "export const x = 1;\n");
    const r = invoke([p, "--quiet"]);
    expect(r.code).toBe(0);
    expect(r.out).toBe("");
  });
});

describe("vet CLI — meta flags", () => {
  it("--help prints usage and exits 0", () => {
    const r = invoke(["--help"]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/Usage:/);
  });

  it("--version prints a version and exits 0", () => {
    const r = invoke(["--version"]);
    expect(r.code).toBe(0);
    expect(r.out.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("an unknown flag exits 2 with an error", () => {
    const r = invoke(["--nope"]);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/vet:/);
  });
});
