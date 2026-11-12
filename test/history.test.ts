import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../src/cli.js";

let repo: string;
let originalCwd: string;
const git = (args: string[]) => execFileSync("git", args, { cwd: repo, stdio: "pipe" });
const write = (name: string, content: string) => writeFileSync(join(repo, name), content);

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
  repo = mkdtempSync(join(tmpdir(), "vet-hist-"));
  git(["init", "-q"]);
  git(["config", "user.email", "qe@vet.test"]);
  git(["config", "user.name", "qe"]);
  // commit 1: introduce a secret
  write("config.ts", 'const AWS = "AKIAIOSFODNN7EXAMPLE1";\nconst x = 1;\n');
  git(["add", "-A"]);
  git(["commit", "-qm", "add config with key"]);
  // commit 2: DELETE the secret — working tree is now clean
  write("config.ts", "const x = 1;\n");
  git(["add", "-A"]);
  git(["commit", "-qm", "remove key"]);
  originalCwd = process.cwd();
  process.chdir(repo);
});

afterAll(() => {
  process.chdir(originalCwd);
  rmSync(repo, { recursive: true, force: true });
});

describe("vet --history", () => {
  it("a working-tree scan is clean (the secret was deleted)", () => {
    const r = invoke(["config.ts", "--fail-on", "any"]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/nothing flagged/);
  });

  it("--history finds the deleted secret at its introducing commit", () => {
    const r = invoke(["--history", "--fail-on", "any"]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/AWS Access Key/);
    expect(r.out).toMatch(/@ [0-9a-f]{7,}/); // commit sha shown
  });

  it("--history --json reports commitsScanned and a commit per finding", () => {
    const r = invoke(["--history", "--json"]);
    const o = JSON.parse(r.out);
    expect(o.commitsScanned).toBe(2);
    expect(o.findings.length).toBeGreaterThan(0);
    expect(o.findings[0].commit).toMatch(/^[0-9a-f]{7,}$/);
    expect(o.findings[0].line).toBe(1); // remapped to the real new-file line
  });

  it("de-duplicates a secret that persists across commits", () => {
    const r = invoke(["--history"]);
    expect((r.out.match(/AWS Access Key/g) ?? []).length).toBe(1);
  });

  it("--since bounds history to the given range", () => {
    // the secret was introduced in commit 1; HEAD~1..HEAD excludes it
    const r = invoke(["--history", "--since", "HEAD~1", "--fail-on", "any"]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/commit\(s\) of history/);
  });
});
