import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../src/cli.js";

// .vetignore is loaded from process.cwd(), so chdir into a temp project.
let dir: string;
let originalCwd: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "vet-vi-"));
  writeFileSync(join(dir, "secret.ts"), 'const k = "AKIAIOSFODNN7EXAMPLE1";\n');
  writeFileSync(join(dir, ".vetignore"), "# ignore the fixture\nsecret.ts\n");
  originalCwd = process.cwd();
  process.chdir(dir);
});
afterAll(() => {
  process.chdir(originalCwd);
  rmSync(dir, { recursive: true, force: true });
});

function invoke(argv: string[]): { code: number; out: string } {
  let out = "";
  const code = run([...argv, "--no-color"], (s) => (out += s), () => {});
  return { code, out };
}

describe("vet CLI — .vetignore (path globs)", () => {
  it("skips an ignored file, exits 0, and reports the skip", () => {
    const r = invoke(["secret.ts"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("skipped by .vetignore");
  });

  it("--no-ignore bypasses the allowlist and finds the secret", () => {
    const r = invoke(["secret.ts", "--no-ignore"]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("AWS Access Key");
  });

  it("--json surfaces filesIgnored and no findings", () => {
    const r = invoke(["secret.ts", "--json"]);
    const o = JSON.parse(r.out);
    expect(o.filesIgnored).toBe(1);
    expect(o.findings).toHaveLength(0);
  });

  it("--ignore-file selects an alternate allowlist (none matches -> finding)", () => {
    writeFileSync(join(dir, "empty.vetignore"), "# nothing\n");
    const r = invoke(["secret.ts", "--ignore-file", "empty.vetignore"]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("AWS Access Key");
  });
});
