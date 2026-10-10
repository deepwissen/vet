import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stagedFiles, changedSince } from "../src/discover.js";
import { run } from "../src/cli.js";

let repo: string;
let originalCwd: string;

function git(args: string[]): void {
  execFileSync("git", args, { cwd: repo, stdio: "pipe" });
}

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), "vet-git-"));
  git(["init", "-q"]);
  git(["config", "user.email", "qe@vet.test"]);
  git(["config", "user.name", "qe"]);
  git(["commit", "--allow-empty", "-m", "base", "-q"]);
  originalCwd = process.cwd();
  process.chdir(repo); // discover's git/readFiles operate on process.cwd()
});

afterAll(() => {
  process.chdir(originalCwd);
  rmSync(repo, { recursive: true, force: true });
});

describe("git staged mode", () => {
  it("stagedFiles() lists staged files", () => {
    writeFileSync(join(repo, "secret.ts"), 'const k = "AKIAIOSFODNN7EXAMPLE1";\n');
    git(["add", "secret.ts"]);
    expect(stagedFiles()).toContain("secret.ts");
  });

  it("default run scans staged changes and exits 1 on a finding", () => {
    // secret.ts staged above carries a secret
    let out = "";
    const code = run(["--no-color"], (s) => (out += s), () => {});
    expect(code).toBe(1);
    expect(out).toContain("AWS Access Key");
  });

  it("run exits 0 when staged files are clean", () => {
    git(["reset", "-q"]); // unstage
    writeFileSync(join(repo, "ok.ts"), "export const x = 1;\n");
    git(["add", "ok.ts"]);
    const code = run(["--no-color", "--quiet"], () => {}, () => {});
    expect(code).toBe(0);
  });
});

describe("git --since mode", () => {
  it("changedSince() lists files changed since a ref", () => {
    git(["add", "-A"]);
    git(["commit", "-m", "snapshot", "-q"]);
    writeFileSync(join(repo, "loader.py"), "import pickle\npickle.load(open('x'))\n");
    git(["add", "loader.py"]);
    git(["commit", "-m", "add loader", "-q"]);
    const changed = changedSince("HEAD~1");
    expect(changed).toContain("loader.py");
  });

  it("run --since scans the changed set", () => {
    let out = "";
    const code = run(["--since", "HEAD~1", "--no-color"], (s) => (out += s), () => {});
    expect(code).toBe(1);
    expect(out).toContain("trap");
  });
});
