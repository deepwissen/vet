import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFiles, expandPaths } from "../src/discover.js";

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "vet-discover-"));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("readFiles", () => {
  it("reads normal text files", () => {
    const p = join(dir, "a.ts");
    writeFileSync(p, "export const x = 1;");
    const files = readFiles([p]);
    expect(files).toHaveLength(1);
    expect(files[0].content).toContain("const x");
  });

  it("skips binary-extension files", () => {
    const p = join(dir, "model.pkl");
    writeFileSync(p, "has a binary ext");
    expect(readFiles([p])).toHaveLength(0);
  });

  it("skips files containing NUL bytes", () => {
    const p = join(dir, "blob.dat");
    writeFileSync(p, Buffer.from("text" + String.fromCharCode(0) + "more"));
    expect(readFiles([p])).toHaveLength(0);
  });

  it("skips oversized files (>1MB)", () => {
    const p = join(dir, "big.txt");
    writeFileSync(p, "a".repeat(1_000_001));
    expect(readFiles([p])).toHaveLength(0);
  });

  it("de-duplicates repeated paths", () => {
    const p = join(dir, "dup.ts");
    writeFileSync(p, "const y = 2;");
    expect(readFiles([p, p])).toHaveLength(1);
  });
});

describe("expandPaths", () => {
  it("returns a file path unchanged", () => {
    const p = join(dir, "single.ts");
    writeFileSync(p, "const z = 3;");
    expect(expandPaths([p])).toEqual([p]);
  });

  it("walks a directory (non-git) and skips ignored dirs", () => {
    const sub = join(dir, "proj");
    mkdirSync(sub);
    mkdirSync(join(sub, "node_modules"));
    writeFileSync(join(sub, "keep.ts"), "const a = 1;");
    writeFileSync(join(sub, "node_modules", "junk.js"), "module.exports = {}");
    const found = expandPaths([sub]);
    expect(found.some((f) => f.endsWith("keep.ts"))).toBe(true);
    expect(found.some((f) => f.includes("node_modules"))).toBe(false);
  });

  it("ignores non-existent paths", () => {
    expect(expandPaths([join(dir, "nope.ts")])).toEqual([]);
  });

  it("lists tracked files of a git dir in ANOTHER repo as usable paths", () => {
    // Regression: expandPaths used to run git against the cwd's repo, which
    // errored (and leaked to stderr) for a dir in a different repo. It must
    // query the target's repo and return real, existing paths.
    const repo = mkdtempSync(join(tmpdir(), "vet-exp-"));
    const g = (args: string[]) => execFileSync("git", args, { cwd: repo, stdio: "pipe" });
    g(["init", "-q"]);
    g(["config", "user.email", "a@b.c"]);
    g(["config", "user.name", "t"]);
    writeFileSync(join(repo, "tracked.ts"), "export const x = 1;");
    writeFileSync(join(repo, "untracked.ts"), "export const y = 2;"); // never `git add`ed
    g(["add", "tracked.ts"]);
    g(["commit", "-m", "init", "-q"]);

    const found = expandPaths([repo]); // cwd here is the vet repo, not `repo`
    expect(found.some((f) => f.endsWith("/tracked.ts"))).toBe(true);
    expect(found.every((f) => existsSync(f))).toBe(true); // paths are real/usable
    expect(found.some((f) => f.endsWith("/untracked.ts"))).toBe(false); // tracking-aware

    rmSync(repo, { recursive: true, force: true });
  });
});
